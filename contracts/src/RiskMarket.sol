// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RiskMarket
/// @notice Continuous prediction market for DeFi protocol risk assessment.
///         RISK token price represents the probability (0–100%) that a monitored
///         protocol will suffer a loss event exceeding $1M within the market duration.
/// @dev Uses a constant-product AMM for trade execution with a bounded price formula:
///      price = usdcPool * 100 / (usdcPool + riskPool)
///      This naturally constrains price to (0, 100). Zone transitions emit events
///      that CRE workflows consume to trigger protective actions.
contract RiskMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ──────────────────────────────────────────────────────────────

    /// @notice Risk zones that trigger graduated protective actions via CRE workflows.
    enum Zone {
        Green,  // 0–greenMax%: Normal operations
        Yellow, // greenMax–yellowMax%: Elevated risk, enhanced monitoring
        Orange, // yellowMax–orangeMax%: Warning, Shield Mode begins
        Red     // orangeMax%+: Critical, full exit & insurance activation
    }

    /// @notice Snapshot of all market state for off-chain consumers.
    struct MarketInfo {
        uint256 riskPrice;
        Zone zone;
        uint256 totalRiskMinted;
        uint256 totalUsdcDeposited;
        uint256 riskPoolReserve;
        uint256 usdcPoolReserve;
        bool resolved;
        uint256 createdAt;
        uint256 duration;
        uint256 greenMax;
        uint256 yellowMax;
        uint256 orangeMax;
    }

    // ── Constants ──────────────────────────────────────────────────────────

    uint256 public constant PRICE_SCALE = 100;
    uint256 public constant SCALE = 1e18;
    uint256 public constant USDC_SCALE = 1e6;
    uint256 public constant VERIFIED_WEIGHT = 100;
    uint256 public constant UNVERIFIED_WEIGHT = 20;
    uint256 public constant MIN_TRADE_USDC = 1e6; // 1 USDC

    // ── State ──────────────────────────────────────────────────────────────

    /// @notice USDC token used as the payment/collateral token.
    IERC20 public immutable usdc;

    /// @notice Virtual RISK reserve in the AMM pool (SCALE precision).
    uint256 public riskPool;

    /// @notice Virtual USDC reserve in the AMM pool (SCALE precision).
    uint256 public usdcPool;

    /// @notice AMM invariant k = riskPool * usdcPool.
    uint256 public invariant;

    /// @notice Cumulative RISK tokens minted to all traders.
    uint256 public totalRiskMinted;

    /// @notice Cumulative USDC deposited by all traders (6-decimal native).
    uint256 public totalUsdcDeposited;

    /// @notice Zone threshold ceilings (integer percentages).
    uint256 public greenMax = 5;
    uint256 public yellowMax = 15;
    uint256 public orangeMax = 35;

    /// @notice Current risk zone derived from the RISK price.
    Zone public currentZone;

    /// @notice True once the market has been resolved (no more trading).
    bool public resolved;

    /// @notice Block timestamp when the market was created.
    uint256 public immutable createdAt;

    /// @notice Duration of the market in seconds.
    uint256 public immutable duration;

    /// @notice WorldIDGate contract authorised to set verification status.
    address public worldIdGate;

    /// @notice CRE workflow address authorised to resolve markets.
    address public creWorkflow;

    /// @notice Internal RISK token balance per user (SCALE precision).
    mapping(address => uint256) public riskBalances;

    /// @notice World ID verification status per user.
    mapping(address => bool) public isVerified;

    // ── Events ─────────────────────────────────────────────────────────────

    /// @notice Emitted when the RISK price crosses a zone threshold.
    event ZoneChanged(uint8 previousZone, uint8 newZone, uint256 riskPrice);

    /// @notice Emitted after every buy or sell trade.
    event TradeExecuted(address indexed trader, bool isBuy, uint256 amount, uint256 newPrice);

    /// @notice Emitted when the market is resolved.
    event MarketResolved(bool lossEvent, uint256 finalPrice);

    // ── Errors ─────────────────────────────────────────────────────────────

    error MarketAlreadyResolved();
    error BelowMinimumTrade();
    error ZeroOutput();
    error InsufficientBalance();
    error InsufficientLiquidity();
    error InvalidThresholds();
    error NotAuthorized();

    // ── Constructor ────────────────────────────────────────────────────────

    /// @notice Deploy a new risk prediction market.
    /// @param _usdc          USDC token address.
    /// @param _initialLiquidity Virtual pool depth in whole units
    ///                          (e.g. 100_000 ≈ $100 K equivalent depth).
    /// @param _initialPrice  Starting risk probability, integer % (e.g. 2 → 2 %).
    /// @param _duration      Market lifespan in seconds (e.g. 30 days = 2_592_000).
    constructor(
        address _usdc,
        uint256 _initialLiquidity,
        uint256 _initialPrice,
        uint256 _duration
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_initialLiquidity > 0, "Zero liquidity");
        require(_initialPrice > 0 && _initialPrice < PRICE_SCALE, "Price out of range");
        require(_duration > 0, "Zero duration");

        usdc = IERC20(_usdc);
        createdAt = block.timestamp;
        duration = _duration;

        // Derive initial virtual reserves so that:
        //   price = usdcPool * 100 / (usdcPool + riskPool) == _initialPrice
        usdcPool = (_initialLiquidity * _initialPrice * SCALE) / PRICE_SCALE;
        riskPool = (_initialLiquidity * (PRICE_SCALE - _initialPrice) * SCALE) / PRICE_SCALE;
        invariant = riskPool * usdcPool;

        currentZone = _priceToZone(_initialPrice);
    }

    // ── Trading ────────────────────────────────────────────────────────────

    /// @notice Buy RISK tokens with USDC.
    /// @dev    Executes a constant-product swap.  World ID weight controls how
    ///         much the trade moves the price (not how many tokens are received).
    /// @param usdcAmount USDC to spend (6-decimal native, e.g. 100e6 = 100 USDC).
    /// @return tokensOut  RISK tokens received (SCALE precision).
    function buyRisk(uint256 usdcAmount) external nonReentrant returns (uint256 tokensOut) {
        if (resolved) revert MarketAlreadyResolved();
        if (usdcAmount < MIN_TRADE_USDC) revert BelowMinimumTrade();

        uint256 scaledIn = (usdcAmount * SCALE) / USDC_SCALE;

        // Constant-product: solve for RISK tokens out
        uint256 newUsdcPool = usdcPool + scaledIn;
        uint256 newRiskPool = invariant / newUsdcPool;
        tokensOut = riskPool - newRiskPool;
        if (tokensOut == 0) revert ZeroOutput();

        // Apply World ID weight – dampens reserve movement, not token output.
        // Verified users move pools 100 %; unverified move pools 20 %.
        // Invariant k is recomputed (it drifts for weighted trades — acceptable
        // trade-off for sybil-resistant pricing in a hackathon context).
        uint256 weight = _getWeight(msg.sender);
        usdcPool += (scaledIn * weight) / VERIFIED_WEIGHT;
        riskPool -= (tokensOut * weight) / VERIFIED_WEIGHT;
        invariant = riskPool * usdcPool;

        // Bookkeeping
        totalUsdcDeposited += usdcAmount;
        totalRiskMinted += tokensOut;
        riskBalances[msg.sender] += tokensOut;

        // Transfer USDC from trader
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Zone check
        uint256 newPrice = getCurrentRiskPrice();
        _checkZoneTransition(newPrice);

        emit TradeExecuted(msg.sender, true, usdcAmount, newPrice);
    }

    /// @notice Sell RISK tokens for USDC.
    /// @param riskAmount RISK tokens to sell (SCALE precision).
    /// @return usdcOut   USDC received (6-decimal native).
    function sellRisk(uint256 riskAmount) external nonReentrant returns (uint256 usdcOut) {
        if (resolved) revert MarketAlreadyResolved();
        if (riskAmount == 0) revert ZeroOutput();
        if (riskBalances[msg.sender] < riskAmount) revert InsufficientBalance();

        // Constant-product: solve for USDC out
        uint256 newRiskPool = riskPool + riskAmount;
        uint256 newUsdcPool = invariant / newRiskPool;
        uint256 scaledOut = usdcPool - newUsdcPool;

        // World ID weighted reserve update
        uint256 weight = _getWeight(msg.sender);
        riskPool += (riskAmount * weight) / VERIFIED_WEIGHT;
        usdcPool -= (scaledOut * weight) / VERIFIED_WEIGHT;
        invariant = riskPool * usdcPool;

        // Convert to USDC native decimals
        usdcOut = (scaledOut * USDC_SCALE) / SCALE;
        if (usdcOut == 0) revert ZeroOutput();
        if (usdc.balanceOf(address(this)) < usdcOut) revert InsufficientLiquidity();

        // Bookkeeping
        riskBalances[msg.sender] -= riskAmount;

        // Transfer USDC to trader
        usdc.safeTransfer(msg.sender, usdcOut);

        // Zone check
        uint256 newPrice = getCurrentRiskPrice();
        _checkZoneTransition(newPrice);

        emit TradeExecuted(msg.sender, false, riskAmount, newPrice);
    }

    // ── View Functions ─────────────────────────────────────────────────────

    /// @notice Current RISK price as an integer percentage (0–99).
    /// @return price  0 = no perceived risk, 99 = near-certain loss event.
    function getCurrentRiskPrice() public view returns (uint256 price) {
        uint256 total = usdcPool + riskPool;
        if (total == 0) return 0;
        price = (usdcPool * PRICE_SCALE) / total;
    }

    /// @notice Current risk zone.
    function getCurrentZone() external view returns (Zone) {
        return currentZone;
    }

    /// @notice Full market state snapshot.
    function getMarketInfo() external view returns (MarketInfo memory) {
        return MarketInfo({
            riskPrice: getCurrentRiskPrice(),
            zone: currentZone,
            totalRiskMinted: totalRiskMinted,
            totalUsdcDeposited: totalUsdcDeposited,
            riskPoolReserve: riskPool,
            usdcPoolReserve: usdcPool,
            resolved: resolved,
            createdAt: createdAt,
            duration: duration,
            greenMax: greenMax,
            yellowMax: yellowMax,
            orangeMax: orangeMax
        });
    }

    // ── Admin Functions ────────────────────────────────────────────────────

    /// @notice Update zone threshold ceilings. Must satisfy green < yellow < orange < 100.
    function setZoneThresholds(
        uint256 _greenMax,
        uint256 _yellowMax,
        uint256 _orangeMax
    ) external onlyOwner {
        if (_greenMax >= _yellowMax || _yellowMax >= _orangeMax || _orangeMax >= PRICE_SCALE) {
            revert InvalidThresholds();
        }
        greenMax = _greenMax;
        yellowMax = _yellowMax;
        orangeMax = _orangeMax;

        _checkZoneTransition(getCurrentRiskPrice());
    }

    /// @notice Set the WorldIDGate contract address.
    function setWorldIdGate(address _gate) external onlyOwner {
        worldIdGate = _gate;
    }

    /// @notice Set the CRE workflow address authorised to resolve the market.
    function setCreWorkflow(address _workflow) external onlyOwner {
        creWorkflow = _workflow;
    }

    /// @notice Mark a user as World ID verified (or revoke).
    /// @dev    Callable only by the WorldIDGate contract or the owner.
    function setVerificationStatus(address user, bool verified) external {
        if (msg.sender != worldIdGate && msg.sender != owner()) revert NotAuthorized();
        isVerified[user] = verified;
    }

    /// @notice Resolve the market.  Payout logic is intentionally deferred.
    /// @param _lossEvent True if the monitored protocol suffered a qualifying loss.
    function resolve(bool _lossEvent) external {
        if (msg.sender != owner() && msg.sender != creWorkflow) revert NotAuthorized();
        if (resolved) revert MarketAlreadyResolved();

        resolved = true;
        emit MarketResolved(_lossEvent, getCurrentRiskPrice());
        // TODO: payout / settlement logic
    }

    // ── Internal ───────────────────────────────────────────────────────────

    /// @dev Returns VERIFIED_WEIGHT (100) or UNVERIFIED_WEIGHT (20).
    function _getWeight(address user) internal view returns (uint256) {
        return isVerified[user] ? VERIFIED_WEIGHT : UNVERIFIED_WEIGHT;
    }

    /// @dev Map a price (0–99) to its corresponding Zone.
    function _priceToZone(uint256 price) internal view returns (Zone) {
        if (price <= greenMax) return Zone.Green;
        if (price <= yellowMax) return Zone.Yellow;
        if (price <= orangeMax) return Zone.Orange;
        return Zone.Red;
    }

    /// @dev Emit ZoneChanged if the price has moved into a different zone.
    function _checkZoneTransition(uint256 price) internal {
        Zone newZone = _priceToZone(price);
        if (newZone != currentZone) {
            emit ZoneChanged(uint8(currentZone), uint8(newZone), price);
            currentZone = newZone;
        }
    }
}
