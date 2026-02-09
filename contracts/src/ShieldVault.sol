// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal interface for querying the RiskMarket price oracle.
interface IRiskMarket {
    function getCurrentRiskPrice() external view returns (uint256);
}

/// @notice Minimal interface for World ID verification checks.
interface IWorldIDGate {
    function isVerified(address user) external view returns (bool);
}

/// @notice Minimal interface for InsurancePool payout requests.
interface IInsurancePool {
    function requestPayout(address user, uint256 amount) external;
}

/// @title ShieldVault — Automated protective withdrawals from monitored protocols
/// @notice Users deposit USDC and activate Shield Mode for automatic protection
///         against DeFi protocol risk.  When the RiskMarket signals danger, CRE
///         workflows call `triggerProtection` to execute graduated actions:
///         Yellow = alert only, Orange = secure 50 %, Red = secure 100 %.
/// @dev    Premium = deposit * riskPrice / 100  (riskPrice is an integer 0–99).
///         Premiums are forwarded to the InsurancePool on activation.
contract ShieldVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────────────────

    /// @notice Basis-point denominator used for premium maths.
    uint256 public constant BPS = 10_000;

    // ── External References ──────────────────────────────────────────────

    /// @notice USDC token used for deposits and premiums.
    IERC20 public immutable usdc;

    /// @notice RiskMarket contract — source of current risk price.
    IRiskMarket public riskMarket;

    /// @notice InsurancePool — receives premiums and pays claims.
    IInsurancePool public insurancePool;

    /// @notice CRE workflow address authorised to trigger protection.
    address public creWorkflow;

    /// @notice WorldIDGate contract for sybil-resistant verification.
    IWorldIDGate public worldIdGate;

    // ── Per-User State ───────────────────────────────────────────────────

    /// @notice USDC deposit balance per user (6-decimal native).
    mapping(address => uint256) public deposits;

    /// @notice Whether Shield Mode is active for a user.
    mapping(address => bool) public shieldActive;

    /// @notice The protocol address each user is protecting against.
    mapping(address => address) public protectedProtocol;

    /// @notice Cumulative premium paid by each user (USDC native).
    mapping(address => uint256) public premiumPaid;

    /// @notice Current protection level per user (0, 50, or 100 %).
    mapping(address => uint256) public protectionLevel;

    /// @notice Amount of the user's deposit currently marked as secured.
    mapping(address => uint256) public securedAmount;

    // ── Shielded-User Tracking ───────────────────────────────────────────

    /// @dev Ordered list of users with an active shield.
    address[] internal _shieldedUsers;

    /// @dev Index + 1 into `_shieldedUsers` (0 = not present).
    mapping(address => uint256) internal _shieldedIndex;

    // ── Events ───────────────────────────────────────────────────────────

    /// @notice Emitted when a user deposits USDC.
    event Deposited(address indexed user, uint256 amount);

    /// @notice Emitted when a user withdraws USDC.
    event Withdrawn(address indexed user, uint256 amount);

    /// @notice Emitted when Shield Mode is activated.
    event ShieldActivated(address indexed user, address protocol, uint256 premium);

    /// @notice Emitted when Shield Mode is deactivated.
    event ShieldDeactivated(address indexed user);

    /// @notice Emitted when the CRE workflow triggers protection for a user.
    event ProtectionTriggered(address indexed user, uint8 zone, uint256 amountSecured);

    /// @notice Emitted when an insurance claim is processed.
    event InsuranceClaimed(address indexed user, uint256 amount);

    // ── Errors ───────────────────────────────────────────────────────────

    error ZeroAmount();
    error InsufficientDeposit();
    error ShieldAlreadyActive();
    error ShieldNotActive();
    error ShieldStillActive();
    error NotVerified();
    error NotAuthorized();
    error ZeroAddress();
    error InvalidProtocol();

    // ── Modifiers ────────────────────────────────────────────────────────

    /// @dev Restricts to the CRE workflow address or the owner.
    modifier onlyAuthorized() {
        if (msg.sender != creWorkflow && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    /// @notice Deploy the ShieldVault.
    /// @param _usdc          USDC token address.
    /// @param _riskMarket    RiskMarket contract for price queries.
    /// @param _insurancePool InsurancePool that receives premiums / pays claims.
    constructor(
        address _usdc,
        address _riskMarket,
        address _insurancePool
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_riskMarket != address(0), "Invalid RiskMarket");
        require(_insurancePool != address(0), "Invalid InsurancePool");

        usdc = IERC20(_usdc);
        riskMarket = IRiskMarket(_riskMarket);
        insurancePool = IInsurancePool(_insurancePool);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Core Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Deposit USDC into the vault.
    /// @param amount USDC to deposit (6-decimal native, e.g. 100e6 = 100 USDC).
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        deposits[msg.sender] += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, amount);
    }

    /// @notice Activate Shield Mode for a specific monitored protocol.
    /// @dev    Requires World ID verification.  Premium is computed from the
    ///         current RiskMarket price and deducted from the caller's deposit.
    /// @param protocol Address of the protocol to protect against.
    function activateShield(address protocol) external nonReentrant {
        if (protocol == address(0)) revert InvalidProtocol();
        if (shieldActive[msg.sender]) revert ShieldAlreadyActive();
        if (address(worldIdGate) == address(0) || !worldIdGate.isVerified(msg.sender)) {
            revert NotVerified();
        }

        uint256 userDeposit = deposits[msg.sender];
        uint256 premium = calculatePremium(userDeposit);
        if (premium == 0 || userDeposit <= premium) revert InsufficientDeposit();

        // Deduct premium from deposit
        deposits[msg.sender] -= premium;
        premiumPaid[msg.sender] += premium;

        // Activate shield
        shieldActive[msg.sender] = true;
        protectedProtocol[msg.sender] = protocol;
        protectionLevel[msg.sender] = 0;
        securedAmount[msg.sender] = 0;

        // Track in shielded users array
        _shieldedUsers.push(msg.sender);
        _shieldedIndex[msg.sender] = _shieldedUsers.length; // index + 1

        // Forward premium to InsurancePool
        usdc.safeTransfer(address(insurancePool), premium);

        emit ShieldActivated(msg.sender, protocol, premium);
    }

    /// @notice Deactivate Shield Mode.  No refund on premium already paid.
    function deactivateShield() external {
        if (!shieldActive[msg.sender]) revert ShieldNotActive();

        shieldActive[msg.sender] = false;
        protectedProtocol[msg.sender] = address(0);
        protectionLevel[msg.sender] = 0;
        securedAmount[msg.sender] = 0;

        _removeShieldedUser(msg.sender);

        emit ShieldDeactivated(msg.sender);
    }

    /// @notice Withdraw USDC from the vault.
    /// @dev    Only allowed when Shield Mode is inactive.
    /// @param amount USDC to withdraw (6-decimal native).
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (shieldActive[msg.sender]) revert ShieldStillActive();
        if (deposits[msg.sender] < amount) revert InsufficientDeposit();

        deposits[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CRE-Triggered Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Called by the Threshold Controller CRE workflow when a zone
    ///         transition is detected on the RiskMarket.
    /// @dev    Iterates all shielded users and applies graduated protection:
    ///         - Yellow (1): Log alert only, no fund movement.
    ///         - Orange (2): Secure 50 % of each user's deposit.
    ///         - Red    (3): Secure 100 % of each user's deposit.
    /// @param zone The current risk zone (0 = Green, 1 = Yellow, 2 = Orange, 3 = Red).
    function triggerProtection(uint8 zone) external onlyAuthorized {
        uint256 len = _shieldedUsers.length;
        for (uint256 i; i < len; i++) {
            address user = _shieldedUsers[i];
            uint256 userDeposit = deposits[user];
            if (userDeposit == 0) continue;

            uint256 amountToSecure;

            if (zone == 1) {
                // Yellow: alert only — no fund movement
                emit ProtectionTriggered(user, zone, 0);
                continue;
            } else if (zone == 2) {
                // Orange: secure 50 % of deposit
                uint256 target = userDeposit / 2;
                if (securedAmount[user] >= target) {
                    emit ProtectionTriggered(user, zone, 0);
                    continue;
                }
                amountToSecure = target - securedAmount[user];
                protectionLevel[user] = 50;
            } else if (zone == 3) {
                // Red: secure 100 % of deposit
                if (securedAmount[user] >= userDeposit) {
                    emit ProtectionTriggered(user, zone, 0);
                    continue;
                }
                amountToSecure = userDeposit - securedAmount[user];
                protectionLevel[user] = 100;
            } else {
                // Green or unknown — no action
                continue;
            }

            securedAmount[user] += amountToSecure;
            emit ProtectionTriggered(user, zone, amountToSecure);
        }
    }

    /// @notice Process an insurance claim after a confirmed loss event.
    /// @dev    Claim is capped at the user's secured amount.  Requests payout
    ///         from InsurancePool on behalf of the user.
    /// @param user       Address of the user to process the claim for.
    /// @param lossAmount Total loss amount to claim (USDC native).
    function processInsuranceClaim(address user, uint256 lossAmount) external onlyAuthorized {
        if (!shieldActive[user]) revert ShieldNotActive();
        if (lossAmount == 0) revert ZeroAmount();

        // Cap claim at the user's secured amount
        uint256 claimable = securedAmount[user];
        uint256 claimAmount = lossAmount > claimable ? claimable : lossAmount;

        securedAmount[user] -= claimAmount;
        if (securedAmount[user] == 0) {
            protectionLevel[user] = 0;
        }

        insurancePool.requestPayout(user, claimAmount);

        emit InsuranceClaimed(user, claimAmount);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  View Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Get the shield status for a user.
    /// @param user Address to query.
    /// @return active     Whether Shield Mode is active.
    /// @return protocol   The protected protocol address.
    /// @return premium    Total premium paid by the user.
    /// @return protection Current protection level (0, 50, or 100).
    function getShieldStatus(address user)
        external
        view
        returns (bool active, address protocol, uint256 premium, uint256 protection)
    {
        return (shieldActive[user], protectedProtocol[user], premiumPaid[user], protectionLevel[user]);
    }

    /// @notice Get the total deposit amount for a user.
    /// @param user Address to query.
    /// @return Total deposit balance (USDC native).
    function getUserDeposit(address user) external view returns (uint256) {
        return deposits[user];
    }

    /// @notice Preview the premium for a given deposit amount based on
    ///         the current RiskMarket price.
    /// @dev    Premium = depositAmount * riskPrice / 100.
    ///         riskPrice is an integer percentage (0–99) from the RiskMarket,
    ///         so premiums naturally scale with perceived risk.
    /// @param depositAmount Deposit to calculate premium for (USDC native).
    /// @return premium The premium amount (USDC native).
    function calculatePremium(uint256 depositAmount) public view returns (uint256 premium) {
        uint256 riskPrice = riskMarket.getCurrentRiskPrice();
        premium = (depositAmount * riskPrice) / 100;
    }

    /// @notice Number of users currently with an active shield.
    function shieldedUserCount() external view returns (uint256) {
        return _shieldedUsers.length;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Admin Functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Set the CRE workflow address authorised to trigger protection.
    function setCreWorkflow(address _workflow) external onlyOwner {
        creWorkflow = _workflow;
    }

    /// @notice Set the WorldIDGate contract address.
    function setWorldIdGate(address _gate) external onlyOwner {
        if (_gate == address(0)) revert ZeroAddress();
        worldIdGate = IWorldIDGate(_gate);
    }

    /// @notice Update the RiskMarket reference.
    function setRiskMarket(address _riskMarket) external onlyOwner {
        if (_riskMarket == address(0)) revert ZeroAddress();
        riskMarket = IRiskMarket(_riskMarket);
    }

    /// @notice Update the InsurancePool reference.
    function setInsurancePool(address _insurancePool) external onlyOwner {
        if (_insurancePool == address(0)) revert ZeroAddress();
        insurancePool = IInsurancePool(_insurancePool);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    /// @dev Remove a user from the shielded-users array (swap-and-pop).
    function _removeShieldedUser(address user) internal {
        uint256 idx = _shieldedIndex[user];
        if (idx == 0) return; // not tracked

        uint256 lastIdx = _shieldedUsers.length;
        if (idx != lastIdx) {
            // Swap with last element
            address last = _shieldedUsers[lastIdx - 1];
            _shieldedUsers[idx - 1] = last;
            _shieldedIndex[last] = idx;
        }
        _shieldedUsers.pop();
        delete _shieldedIndex[user];
    }
}
