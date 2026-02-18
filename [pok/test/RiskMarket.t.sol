// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {RiskMarket} from "../src/RiskMarket.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal mock USDC with 6 decimals and public mint.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract RiskMarketTest is Test {
    RiskMarket public market;
    MockUSDC public usdc;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public worldIdGate = makeAddr("worldIdGate");
    address public creWorkflow = makeAddr("creWorkflow");

    uint256 constant INITIAL_LIQUIDITY = 100_000;
    uint256 constant INITIAL_PRICE = 2; // 2 %
    uint256 constant DURATION = 30 days;
    uint256 constant SCALE = 1e18;
    uint256 constant USDC = 1e6; // 1 USDC in native decimals

    function setUp() public {
        usdc = new MockUSDC();
        market = new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);

        market.setWorldIdGate(worldIdGate);
        market.setCreWorkflow(creWorkflow);

        // Fund users with 1 M USDC each and approve the market
        usdc.mint(alice, 1_000_000 * USDC);
        usdc.mint(bob, 1_000_000 * USDC);

        vm.prank(alice);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(market), type(uint256).max);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    function _verify(address user) internal {
        market.setVerificationStatus(user, true);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  1. Deployment
    // ════════════════════════════════════════════════════════════════════════

    function test_Deploy_CorrectInitialState() public view {
        assertEq(address(market.usdc()), address(usdc));
        assertEq(market.greenMax(), 5);
        assertEq(market.yellowMax(), 15);
        assertEq(market.orangeMax(), 35);
        assertEq(market.duration(), DURATION);
        assertEq(market.createdAt(), block.timestamp);
        assertFalse(market.resolved());
        assertEq(market.totalRiskMinted(), 0);
        assertEq(market.totalUsdcDeposited(), 0);
    }

    function test_Deploy_InitialZoneIsGreen() public view {
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Green));
    }

    function test_Deploy_InitialPriceMatchesArg() public view {
        assertEq(market.getCurrentRiskPrice(), INITIAL_PRICE);
    }

    function test_Deploy_PoolReservesNonZero() public view {
        assertGt(market.riskPool(), 0);
        assertGt(market.usdcPool(), 0);
        assertGt(market.invariant(), 0);
    }

    function test_Deploy_RevertsOnZeroUSDC() public {
        vm.expectRevert("Invalid USDC");
        new RiskMarket(address(0), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);
    }

    function test_Deploy_RevertsOnZeroLiquidity() public {
        vm.expectRevert("Zero liquidity");
        new RiskMarket(address(usdc), 0, INITIAL_PRICE, DURATION);
    }

    function test_Deploy_RevertsOnPriceOutOfRange() public {
        vm.expectRevert("Price out of range");
        new RiskMarket(address(usdc), INITIAL_LIQUIDITY, 0, DURATION);

        vm.expectRevert("Price out of range");
        new RiskMarket(address(usdc), INITIAL_LIQUIDITY, 100, DURATION);
    }

    function test_Deploy_RevertsOnZeroDuration() public {
        vm.expectRevert("Zero duration");
        new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, 0);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  2. Buy RISK
    // ════════════════════════════════════════════════════════════════════════

    function test_Buy_TransfersUSDCFromTrader() public {
        uint256 buyAmt = 100 * USDC;
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        market.buyRisk(buyAmt);

        assertEq(usdc.balanceOf(alice), balBefore - buyAmt);
        assertEq(usdc.balanceOf(address(market)), buyAmt);
    }

    function test_Buy_CreditsRiskTokens() public {
        vm.prank(alice);
        uint256 tokensOut = market.buyRisk(100 * USDC);

        assertGt(tokensOut, 0);
        assertEq(market.riskBalances(alice), tokensOut);
    }

    function test_Buy_IncreasesPrice() public {
        _verify(alice);
        uint256 priceBefore = market.getCurrentRiskPrice();

        vm.prank(alice);
        market.buyRisk(2000 * USDC);

        assertGt(market.getCurrentRiskPrice(), priceBefore);
    }

    function test_Buy_UpdatesTotals() public {
        uint256 buyAmt = 500 * USDC;

        vm.prank(alice);
        uint256 tokensOut = market.buyRisk(buyAmt);

        assertEq(market.totalUsdcDeposited(), buyAmt);
        assertEq(market.totalRiskMinted(), tokensOut);
    }

    function test_Buy_EmitsTradeExecuted() public {
        uint256 buyAmt = 100 * USDC;

        vm.expectEmit(true, false, false, false, address(market));
        emit RiskMarket.TradeExecuted(alice, true, buyAmt, 0);

        vm.prank(alice);
        market.buyRisk(buyAmt);
    }

    function test_Buy_MultipleBuysAccumulate() public {
        vm.startPrank(alice);
        uint256 t1 = market.buyRisk(100 * USDC);
        uint256 t2 = market.buyRisk(200 * USDC);
        vm.stopPrank();

        assertEq(market.riskBalances(alice), t1 + t2);
        assertEq(market.totalUsdcDeposited(), 300 * USDC);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  3. Sell RISK
    // ════════════════════════════════════════════════════════════════════════

    function test_Sell_ReturnsUSDC() public {
        vm.startPrank(alice);
        uint256 tokensOut = market.buyRisk(1000 * USDC);
        uint256 balBefore = usdc.balanceOf(alice);

        uint256 usdcOut = market.sellRisk(tokensOut);
        vm.stopPrank();

        assertGt(usdcOut, 0);
        assertEq(usdc.balanceOf(alice), balBefore + usdcOut);
    }

    function test_Sell_DecreasesPrice() public {
        _verify(alice);

        vm.startPrank(alice);
        uint256 tokensOut = market.buyRisk(2000 * USDC);
        uint256 priceAfterBuy = market.getCurrentRiskPrice();

        market.sellRisk(tokensOut / 2);
        vm.stopPrank();

        assertLt(market.getCurrentRiskPrice(), priceAfterBuy);
    }

    function test_Sell_DebitsRiskBalance() public {
        vm.startPrank(alice);
        uint256 tokensOut = market.buyRisk(1000 * USDC);
        uint256 sellAmt = tokensOut / 2;

        market.sellRisk(sellAmt);
        vm.stopPrank();

        assertEq(market.riskBalances(alice), tokensOut - sellAmt);
    }

    function test_Sell_EmitsTradeExecuted() public {
        vm.startPrank(alice);
        uint256 tokensOut = market.buyRisk(1000 * USDC);

        vm.expectEmit(true, false, false, false, address(market));
        emit RiskMarket.TradeExecuted(alice, false, tokensOut, 0);

        market.sellRisk(tokensOut);
        vm.stopPrank();
    }

    function test_Sell_VerifiedRoundTrip_ReturnsToInitialPrice() public {
        _verify(alice);

        vm.startPrank(alice);
        uint256 tokensOut = market.buyRisk(5000 * USDC);
        market.sellRisk(tokensOut);
        vm.stopPrank();

        // For a verified user (100 % weight) the invariant is preserved,
        // so a full round-trip returns to the exact starting price.
        assertEq(market.getCurrentRiskPrice(), INITIAL_PRICE);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  4. Zone Transitions
    // ════════════════════════════════════════════════════════════════════════

    // With initialLiquidity = 100_000 and initialPrice = 2 (verified user):
    //   Buy 2 000 USDC → price ≈ 7 %  (Yellow)
    //   Buy 3 000 USDC → price = 20 % (Orange)
    //   Buy 5 000 USDC → price ≈ 42 % (Red)

    function test_Zone_GreenToYellow() public {
        _verify(alice);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Green));

        vm.prank(alice);
        market.buyRisk(2000 * USDC);

        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Yellow));
        assertGt(market.getCurrentRiskPrice(), 5);
    }

    function test_Zone_YellowToOrange() public {
        _verify(alice);

        vm.startPrank(alice);
        market.buyRisk(2000 * USDC); // → Yellow
        market.buyRisk(3000 * USDC); // → Orange
        vm.stopPrank();

        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Orange));
        assertGt(market.getCurrentRiskPrice(), 15);
    }

    function test_Zone_OrangeToRed() public {
        _verify(alice);

        vm.startPrank(alice);
        market.buyRisk(2000 * USDC);  // → Yellow
        market.buyRisk(3000 * USDC);  // → Orange
        market.buyRisk(5000 * USDC);  // → Red
        vm.stopPrank();

        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Red));
        assertGt(market.getCurrentRiskPrice(), 35);
    }

    function test_Zone_EmitsZoneChangedOnTransition() public {
        _verify(alice);

        // Expect a ZoneChanged event (Green → Yellow, price = 7)
        vm.expectEmit(false, false, false, true, address(market));
        emit RiskMarket.ZoneChanged(
            uint8(RiskMarket.Zone.Green),
            uint8(RiskMarket.Zone.Yellow),
            7
        );

        vm.prank(alice);
        market.buyRisk(2000 * USDC);
    }

    function test_Zone_NoEventWhenZoneUnchanged() public {
        _verify(alice);

        // A small buy that stays in Green should NOT emit ZoneChanged.
        vm.recordLogs();
        vm.prank(alice);
        market.buyRisk(10 * USDC); // tiny — stays Green

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 zoneChangedSig = keccak256("ZoneChanged(uint8,uint8,uint256)");

        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != zoneChangedSig, "ZoneChanged should not fire");
        }
    }

    function test_Zone_SellBringsBackDown() public {
        _verify(alice);

        // Push all the way to Red
        vm.startPrank(alice);
        uint256 t1 = market.buyRisk(2000 * USDC);
        uint256 t2 = market.buyRisk(3000 * USDC);
        uint256 t3 = market.buyRisk(5000 * USDC);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Red));

        // Sell everything back — should return to Green
        market.sellRisk(t1 + t2 + t3);
        vm.stopPrank();

        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Green));
        // Multiple sequential buys accumulate integer rounding in the invariant;
        // price may drift by ±1. Use approximate comparison.
        assertApproxEqAbs(market.getCurrentRiskPrice(), INITIAL_PRICE, 1);
    }

    function test_Zone_AllTransitionsUpAndDown() public {
        _verify(alice);

        // Ramp up
        vm.startPrank(alice);
        uint256 t1 = market.buyRisk(2000 * USDC);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Yellow));

        uint256 t2 = market.buyRisk(3000 * USDC);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Orange));

        uint256 t3 = market.buyRisk(5000 * USDC);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Red));

        // Sell in stages to ramp down
        // Sell t3 first — removes the Red push, should drop into Orange or lower
        market.sellRisk(t3);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Orange));

        market.sellRisk(t2);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Yellow));

        market.sellRisk(t1);
        assertEq(uint8(market.getCurrentZone()), uint8(RiskMarket.Zone.Green));

        vm.stopPrank();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  5. World ID Weighting
    // ════════════════════════════════════════════════════════════════════════

    function test_Weight_VerifiedMovesMorePrice() public {
        // Two identical fresh markets — one with verified trader, one without.
        RiskMarket mktVerified = new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);
        RiskMarket mktUnverified = new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);

        mktVerified.setVerificationStatus(alice, true);
        // bob remains unverified (default)

        vm.prank(alice);
        usdc.approve(address(mktVerified), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(mktUnverified), type(uint256).max);

        uint256 buyAmt = 1000 * USDC;

        vm.prank(alice);
        mktVerified.buyRisk(buyAmt);
        vm.prank(bob);
        mktUnverified.buyRisk(buyAmt);

        // Verified user's trade should move price more
        assertGt(mktVerified.getCurrentRiskPrice(), mktUnverified.getCurrentRiskPrice());
    }

    function test_Weight_SameTokensReceivedRegardlessOfStatus() public {
        // Two identical fresh markets
        RiskMarket mktA = new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);
        RiskMarket mktB = new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);

        mktA.setVerificationStatus(alice, true);
        // alice unverified in mktB

        vm.prank(alice);
        usdc.approve(address(mktA), type(uint256).max);
        vm.prank(alice);
        usdc.approve(address(mktB), type(uint256).max);

        uint256 buyAmt = 1000 * USDC;

        vm.prank(alice);
        uint256 tokensA = mktA.buyRisk(buyAmt);
        vm.prank(alice);
        uint256 tokensB = mktB.buyRisk(buyAmt);

        // Token output is identical — weight only affects price movement.
        assertEq(tokensA, tokensB);
    }

    function test_Weight_SetByOwner() public {
        market.setVerificationStatus(alice, true);
        assertTrue(market.isVerified(alice));

        market.setVerificationStatus(alice, false);
        assertFalse(market.isVerified(alice));
    }

    function test_Weight_SetByWorldIdGate() public {
        vm.prank(worldIdGate);
        market.setVerificationStatus(bob, true);
        assertTrue(market.isVerified(bob));
    }

    function test_Weight_RejectsUnauthorizedCaller() public {
        vm.prank(alice);
        vm.expectRevert(RiskMarket.NotAuthorized.selector);
        market.setVerificationStatus(bob, true);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  6. Edge Cases & Reverts
    // ════════════════════════════════════════════════════════════════════════

    function test_Revert_BuyBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(RiskMarket.BelowMinimumTrade.selector);
        market.buyRisk(USDC - 1); // 0.999999 USDC
    }

    function test_Revert_BuyZero() public {
        vm.prank(alice);
        vm.expectRevert(RiskMarket.BelowMinimumTrade.selector);
        market.buyRisk(0);
    }

    function test_Revert_SellZero() public {
        vm.prank(alice);
        vm.expectRevert(RiskMarket.ZeroOutput.selector);
        market.sellRisk(0);
    }

    function test_Revert_SellMoreThanOwned() public {
        vm.prank(alice);
        vm.expectRevert(RiskMarket.InsufficientBalance.selector);
        market.sellRisk(1e18);
    }

    function test_Revert_BuyAfterResolved() public {
        market.resolve(false);

        vm.prank(alice);
        vm.expectRevert(RiskMarket.MarketAlreadyResolved.selector);
        market.buyRisk(100 * USDC);
    }

    function test_Revert_SellAfterResolved() public {
        vm.prank(alice);
        uint256 tokens = market.buyRisk(100 * USDC);

        market.resolve(false);

        vm.prank(alice);
        vm.expectRevert(RiskMarket.MarketAlreadyResolved.selector);
        market.sellRisk(tokens);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  7. Resolve & Access Control
    // ════════════════════════════════════════════════════════════════════════

    function test_Resolve_ByOwner() public {
        market.resolve(false);
        assertTrue(market.resolved());
    }

    function test_Resolve_ByCREWorkflow() public {
        vm.prank(creWorkflow);
        market.resolve(true);
        assertTrue(market.resolved());
    }

    function test_Resolve_EmitsEvent() public {
        vm.expectEmit(false, false, false, true, address(market));
        emit RiskMarket.MarketResolved(false, INITIAL_PRICE);
        market.resolve(false);
    }

    function test_Resolve_RejectsUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(RiskMarket.NotAuthorized.selector);
        market.resolve(false);
    }

    function test_Resolve_CannotResolveTwice() public {
        market.resolve(false);

        vm.expectRevert(RiskMarket.MarketAlreadyResolved.selector);
        market.resolve(true);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  8. Admin
    // ════════════════════════════════════════════════════════════════════════

    function test_Admin_SetZoneThresholds() public {
        market.setZoneThresholds(10, 30, 60);
        assertEq(market.greenMax(), 10);
        assertEq(market.yellowMax(), 30);
        assertEq(market.orangeMax(), 60);
    }

    function test_Admin_SetZoneThresholds_RevertsOnInvalidOrder() public {
        vm.expectRevert(RiskMarket.InvalidThresholds.selector);
        market.setZoneThresholds(20, 10, 60); // green > yellow

        vm.expectRevert(RiskMarket.InvalidThresholds.selector);
        market.setZoneThresholds(5, 15, 100); // orange == PRICE_SCALE
    }

    function test_Admin_SetZoneThresholds_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        market.setZoneThresholds(10, 30, 60);
    }

    function test_Admin_SetWorldIdGate() public {
        address newGate = makeAddr("newGate");
        market.setWorldIdGate(newGate);
        assertEq(market.worldIdGate(), newGate);
    }

    function test_Admin_SetCreWorkflow() public {
        address newCre = makeAddr("newCre");
        market.setCreWorkflow(newCre);
        assertEq(market.creWorkflow(), newCre);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  9. View — getMarketInfo
    // ════════════════════════════════════════════════════════════════════════

    function test_GetMarketInfo_ReturnsCorrectSnapshot() public view {
        RiskMarket.MarketInfo memory info = market.getMarketInfo();

        assertEq(info.riskPrice, INITIAL_PRICE);
        assertEq(uint8(info.zone), uint8(RiskMarket.Zone.Green));
        assertEq(info.totalRiskMinted, 0);
        assertEq(info.totalUsdcDeposited, 0);
        assertGt(info.riskPoolReserve, 0);
        assertGt(info.usdcPoolReserve, 0);
        assertFalse(info.resolved);
        assertEq(info.duration, DURATION);
        assertEq(info.greenMax, 5);
        assertEq(info.yellowMax, 15);
        assertEq(info.orangeMax, 35);
    }
}
