// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title InsurancePool — Shared liquidity pool for PRISM protection payouts
/// @notice Liquidity providers deposit USDC to back Shield Mode coverage.
///         Premiums from shield activations flow into the pool as LP yield.
///         Claims are paid out when loss events occur, capped by a maximum
///         utilization ratio to preserve pool solvency.
/// @dev    Uses a share-based accounting model: LP shares represent proportional
///         ownership of the pool.  Premiums increase pool value without minting
///         new shares, so existing LPs earn yield automatically.
contract InsurancePool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────────────────

    /// @notice Basis-point denominator (100 % = 10 000).
    uint256 public constant BPS = 10_000;

    // ── State ────────────────────────────────────────────────────────────

    /// @notice USDC token used across the protocol.
    IERC20 public immutable usdc;

    /// @notice Total USDC in the pool (LP deposits + premiums - claims).
    uint256 public totalPoolBalance;

    /// @notice Total pool shares outstanding.
    uint256 public totalShares;

    /// @notice Cumulative premiums collected from Shield Mode activations.
    uint256 public totalPremiumsCollected;

    /// @notice Cumulative claims paid out to users.
    uint256 public totalClaimsPaid;

    /// @notice Maximum utilization in basis points (e.g. 8 000 = 80 %).
    ///         Claims cannot consume more than this fraction of the pool.
    uint256 public maxUtilizationBps;

    /// @notice When true, the pool will not accept new shield coverage requests.
    bool public paused;

    /// @notice ShieldVault address — authorised to request claim payouts.
    address public shieldVault;

    /// @notice CRE workflow address — authorised for pool health operations.
    address public creWorkflow;

    /// @notice Pool shares per LP.
    mapping(address => uint256) public lpShares;

    /// @notice Cumulative USDC deposited by each LP (for tracking, not yield calc).
    mapping(address => uint256) public lpDeposited;

    // ── Events ───────────────────────────────────────────────────────────

    /// @notice Emitted when an LP deposits liquidity.
    event LiquidityDeposited(address indexed lp, uint256 amount);

    /// @notice Emitted when an LP withdraws liquidity.
    event LiquidityWithdrawn(address indexed lp, uint256 amount);

    /// @notice Emitted when a premium is received from ShieldVault.
    event PremiumReceived(uint256 amount);

    /// @notice Emitted when a claim is paid out.
    event ClaimPaid(address indexed user, uint256 amount);

    /// @notice Emitted by the CRE Reserve Verifier with current pool metrics.
    event PoolHealthUpdated(uint256 totalLiquidity, uint256 utilizationRatio);

    /// @notice Emitted when new shields are paused.
    event PoolPaused();

    /// @notice Emitted when new shields are resumed.
    event PoolResumed();

    // ── Errors ───────────────────────────────────────────────────────────

    error ZeroAmount();
    error InsufficientShares();
    error InsufficientLiquidity();
    error ExceedsUtilization();
    error PoolIsPaused();
    error NotAuthorized();
    error ZeroAddress();

    // ── Modifiers ────────────────────────────────────────────────────────

    /// @dev Restricts to the CRE workflow address or the owner.
    modifier onlyAuthorized() {
        if (msg.sender != creWorkflow && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    /// @dev Restricts to the ShieldVault, CRE workflow, or the owner.
    modifier onlyVaultOrAuthorized() {
        if (msg.sender != shieldVault && msg.sender != creWorkflow && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    /// @notice Deploy the InsurancePool.
    /// @param _usdc               USDC token address.
    /// @param _maxUtilizationBps  Maximum utilization in basis points (e.g. 8000 = 80 %).
    constructor(address _usdc, uint256 _maxUtilizationBps) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_maxUtilizationBps > 0 && _maxUtilizationBps <= BPS, "Invalid utilization");

        usdc = IERC20(_usdc);
        maxUtilizationBps = _maxUtilizationBps;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  LP Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Deposit USDC as liquidity.  Shares are minted proportionally
    ///         to the current pool value.
    /// @param amount USDC to deposit (6-decimal native).
    function depositLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 sharesToMint;
        if (totalShares == 0 || totalPoolBalance == 0) {
            // First deposit: 1 USDC = 1 share (scaled to USDC decimals)
            sharesToMint = amount;
        } else {
            sharesToMint = (amount * totalShares) / totalPoolBalance;
        }

        lpShares[msg.sender] += sharesToMint;
        lpDeposited[msg.sender] += amount;
        totalShares += sharesToMint;
        totalPoolBalance += amount;

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit LiquidityDeposited(msg.sender, amount);
    }

    /// @notice Withdraw USDC from the pool by burning shares.
    /// @dev    Blocked if withdrawal would push the pool below the minimum
    ///         reserve required by the utilization cap.
    /// @param amount USDC to withdraw (6-decimal native).
    function withdrawLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (totalPoolBalance == 0 || totalShares == 0) revert InsufficientLiquidity();

        // Calculate shares to burn for requested USDC amount
        uint256 sharesToBurn = (amount * totalShares + totalPoolBalance - 1) / totalPoolBalance;
        if (lpShares[msg.sender] < sharesToBurn) revert InsufficientShares();

        // Ensure pool retains minimum reserve after withdrawal
        uint256 poolAfter = totalPoolBalance - amount;
        uint256 minReserve = (totalPoolBalance * (BPS - maxUtilizationBps)) / BPS;
        if (poolAfter < minReserve) revert ExceedsUtilization();

        lpShares[msg.sender] -= sharesToBurn;
        totalShares -= sharesToBurn;
        totalPoolBalance -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ShieldVault Integration
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Receive premium USDC from ShieldVault.
    /// @dev    Increases pool value without minting new shares, so existing
    ///         LPs automatically earn yield.  Caller must have approved this
    ///         contract for `amount` USDC.
    /// @param amount USDC premium to receive (6-decimal native).
    function receivePremium(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        totalPoolBalance += amount;
        totalPremiumsCollected += amount;

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit PremiumReceived(amount);
    }

    /// @notice Pay out a claim to a user.  Called by ShieldVault after
    ///         `processInsuranceClaim`, or directly by the CRE workflow.
    /// @dev    This is the function referenced by ShieldVault's IInsurancePool
    ///         interface as `requestPayout`.
    /// @param user   Recipient of the claim payout.
    /// @param amount USDC to transfer (6-decimal native).
    function requestPayout(address user, uint256 amount) external onlyVaultOrAuthorized nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > availableForClaims()) revert ExceedsUtilization();
        if (amount > totalPoolBalance) revert InsufficientLiquidity();

        totalPoolBalance -= amount;
        totalClaimsPaid += amount;

        usdc.safeTransfer(user, amount);

        emit ClaimPaid(user, amount);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CRE-Triggered Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Called by the Reserve Verifier CRE workflow to report pool health.
    /// @dev    Calculates current utilization and emits a health update event.
    function updatePoolHealth() external onlyAuthorized {
        uint256 utilization = currentUtilizationBps();
        emit PoolHealthUpdated(totalPoolBalance, utilization);
    }

    /// @notice Pause new Shield Mode activations when pool solvency is low.
    function pauseNewShields() external onlyAuthorized {
        paused = true;
        emit PoolPaused();
    }

    /// @notice Resume new Shield Mode activations once solvency recovers.
    function resumeNewShields() external onlyAuthorized {
        paused = false;
        emit PoolResumed();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  View Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Maximum USDC available for claim payouts under the utilization cap.
    /// @return Available USDC (6-decimal native).
    function availableForClaims() public view returns (uint256) {
        return (totalPoolBalance * maxUtilizationBps) / BPS;
    }

    /// @notice Current utilization ratio in basis points.
    /// @dev    Utilization = claimsPaid / (pool + claimsPaid).
    ///         Returns 0 when pool is empty and no claims have been made.
    function currentUtilizationBps() public view returns (uint256) {
        uint256 totalCapital = totalPoolBalance + totalClaimsPaid;
        if (totalCapital == 0) return 0;
        return (totalClaimsPaid * BPS) / totalCapital;
    }

    /// @notice Full pool health snapshot.
    /// @return totalLiquidity       Current pool balance (USDC).
    /// @return premiumsCollected    Cumulative premiums received.
    /// @return claimsPaid           Cumulative claims paid out.
    /// @return utilizationRatio     Current utilization in basis points.
    /// @return isPaused             Whether new shields are paused.
    function getPoolHealth()
        external
        view
        returns (
            uint256 totalLiquidity,
            uint256 premiumsCollected,
            uint256 claimsPaid,
            uint256 utilizationRatio,
            bool isPaused
        )
    {
        return (totalPoolBalance, totalPremiumsCollected, totalClaimsPaid, currentUtilizationBps(), paused);
    }

    /// @notice Get an LP's current position.
    /// @param lp Address to query.
    /// @return deposited       Cumulative USDC deposited.
    /// @return shares          Current share balance.
    /// @return currentValue    USDC value of shares at current pool price.
    /// @return sharePercentage LP's share of pool in basis points.
    function getLPPosition(address lp)
        external
        view
        returns (uint256 deposited, uint256 shares, uint256 currentValue, uint256 sharePercentage)
    {
        deposited = lpDeposited[lp];
        shares = lpShares[lp];
        currentValue = totalShares > 0 ? (shares * totalPoolBalance) / totalShares : 0;
        sharePercentage = totalShares > 0 ? (shares * BPS) / totalShares : 0;
    }

    /// @notice Check whether the pool can accept a new shield for the given
    ///         coverage amount.
    /// @param coverageAmount The USDC coverage required.
    /// @return True if pool has sufficient available capacity.
    function canAcceptNewShield(uint256 coverageAmount) external view returns (bool) {
        if (paused) return false;
        return coverageAmount <= availableForClaims();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Admin Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Set the ShieldVault address authorised to request payouts.
    function setShieldVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        shieldVault = _vault;
    }

    /// @notice Set the CRE workflow address.
    function setCreWorkflow(address _workflow) external onlyOwner {
        creWorkflow = _workflow;
    }

    /// @notice Update the maximum utilization ratio.
    /// @param _maxUtilizationBps New cap in basis points (1–10 000).
    function setMaxUtilization(uint256 _maxUtilizationBps) external onlyOwner {
        require(_maxUtilizationBps > 0 && _maxUtilizationBps <= BPS, "Invalid utilization");
        maxUtilizationBps = _maxUtilizationBps;
    }
}
