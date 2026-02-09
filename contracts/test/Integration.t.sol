// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {RiskMarket} from "../src/RiskMarket.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {InsurancePool} from "../src/InsurancePool.sol";
import {WorldIDGate} from "../src/WorldIDGate.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {PRISMToken} from "../src/PRISMToken.sol";
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

/// @title Integration Test — Full Protection Cycle
/// @notice Tests the complete cross-contract flow:
///         Deploy → Deposit → Shield → Zone escalation → Protection → Insurance claim.
contract IntegrationTest is Test {
    // ── Contracts ────────────────────────────────────────────────────────
    MockUSDC public usdc;
    RiskMarket public market;
    InsurancePool public pool;
    ShieldVault public vault;
    WorldIDGate public gate;
    PRISMToken public prism;

    // ── Actors ───────────────────────────────────────────────────────────
    address public deployer; // Owner / CRE stand-in
    address public lp = makeAddr("lp");
    address public user = makeAddr("user");
    address public trader = makeAddr("trader");

    // ── Constants ────────────────────────────────────────────────────────
    uint256 constant USDC_UNIT = 1e6;
    uint256 constant INITIAL_LIQUIDITY = 100_000;
    uint256 constant INITIAL_PRICE = 2;
    uint256 constant DURATION = 30 days;
    uint256 constant MAX_UTILIZATION_BPS = 8_000; // 80 %
    uint256 constant LP_DEPOSIT = 500_000 * USDC_UNIT;
    uint256 constant USER_DEPOSIT = 10_000 * USDC_UNIT;

    // ── Setup ────────────────────────────────────────────────────────────

    function setUp() public {
        deployer = address(this); // test contract is the deployer

        // 1. Deploy all contracts
        usdc = new MockUSDC();
        market = new RiskMarket(address(usdc), INITIAL_LIQUIDITY, INITIAL_PRICE, DURATION);
        pool = new InsurancePool(address(usdc), MAX_UTILIZATION_BPS);
        vault = new ShieldVault(address(usdc), address(market), address(pool));
        gate = new WorldIDGate(IWorldID(address(0)), "app_prism", "prism-verify", 1);
        prism = new PRISMToken();

        // 2. Cross-contract wiring
        market.setWorldIdGate(address(gate));
        market.setCreWorkflow(deployer);

        vault.setWorldIdGate(address(gate));
        vault.setCreWorkflow(deployer);

        pool.setShieldVault(address(vault));
        pool.setCreWorkflow(deployer);

        gate.setRiskMarket(address(market));
        gate.setMockMode(true);

        // 3. Fund actors
        usdc.mint(lp, 1_000_000 * USDC_UNIT);
        usdc.mint(user, 100_000 * USDC_UNIT);
        usdc.mint(trader, 10_000_000 * USDC_UNIT);

        // 4. Approvals
        vm.prank(lp);
        usdc.approve(address(pool), type(uint256).max);

        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(trader);
        usdc.approve(address(market), type(uint256).max);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Full Protection Cycle
    // ══════════════════════════════════════════════════════════════════════

    function test_FullProtectionCycle() public {
        // ── Step 1: LP seeds the InsurancePool ──────────────────────────
        vm.prank(lp);
        pool.depositLiquidity(LP_DEPOSIT);

        assertEq(pool.totalPoolBalance(), LP_DEPOSIT);
        assertEq(pool.totalShares(), LP_DEPOSIT);
        assertEq(usdc.balanceOf(address(pool)), LP_DEPOSIT);

        // ── Step 2: Mock-verify the user via WorldIDGate ────────────────
        gate.mockVerify(user);
        assertTrue(gate.isVerified(user));
        assertTrue(market.isVerified(user)); // propagated to RiskMarket

        // ── Step 3: User deposits into ShieldVault and activates shield ─
        vm.prank(user);
        vault.deposit(USER_DEPOSIT);
        assertEq(vault.deposits(user), USER_DEPOSIT);

        // Calculate expected premium: deposit * riskPrice / 100
        uint256 priceBefore = market.getCurrentRiskPrice();
        assertEq(priceBefore, INITIAL_PRICE); // 2 %
        uint256 expectedPremium = (USER_DEPOSIT * priceBefore) / 100; // 200 USDC

        uint256 poolUsdcBefore = usdc.balanceOf(address(pool));

        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit ShieldVault.ShieldActivated(user, address(0xBEEF), expectedPremium);
        vault.activateShield(address(0xBEEF));

        // Verify premium deducted from deposit
        uint256 depositAfterPremium = USER_DEPOSIT - expectedPremium;
        assertEq(vault.deposits(user), depositAfterPremium);
        assertEq(vault.premiumPaid(user), expectedPremium);
        assertTrue(vault.shieldActive(user));
        assertEq(vault.shieldedUserCount(), 1);

        // Verify InsurancePool received premium (direct transfer, not via receivePremium)
        assertEq(usdc.balanceOf(address(pool)), poolUsdcBefore + expectedPremium);

        // ── Step 4: Green Zone — normal operations ──────────────────────
        assertEq(uint8(market.currentZone()), 0); // Green
        assertEq(market.getCurrentRiskPrice(), INITIAL_PRICE);

        // ── Step 5: Push price to Yellow (>5%) ──────────────────────────
        // Verified trader buys RISK to push price up.
        // AMM initial pool: usdcPool=2,000e18, riskPool=98,000e18.
        // Calibrated buys to land cleanly in each zone.
        market.setVerificationStatus(trader, true);

        uint256 priceAfterBuy;
        {
            vm.prank(trader);
            market.buyRisk(2_500 * USDC_UNIT); // ~9 % → Yellow
            priceAfterBuy = market.getCurrentRiskPrice();
        }

        // Price should be in Yellow range (>5, <=15)
        assertGt(priceAfterBuy, 5, "Price should be above Green max");
        assertLe(priceAfterBuy, 15, "Price should be in Yellow zone");
        assertEq(uint8(market.currentZone()), 1); // Yellow

        // CRE workflow triggers Yellow protection
        vault.triggerProtection(1); // Yellow

        // Yellow = alert only, no fund movement
        assertEq(vault.securedAmount(user), 0, "Yellow should not secure funds");
        assertEq(vault.protectionLevel(user), 0, "Yellow should not change protection level");

        // ── Step 6: Push price to Orange (>15%) ─────────────────────────
        {
            vm.prank(trader);
            market.buyRisk(3_500 * USDC_UNIT); // ~24 % → Orange
            priceAfterBuy = market.getCurrentRiskPrice();
        }

        assertGt(priceAfterBuy, 15, "Price should be above Yellow max");
        assertLe(priceAfterBuy, 35, "Price should be in Orange zone");
        assertEq(uint8(market.currentZone()), 2); // Orange

        // CRE workflow triggers Orange protection
        uint256 expectedOrangeSecured = depositAfterPremium / 2; // 50 %

        vm.expectEmit(true, false, false, true);
        emit ShieldVault.ProtectionTriggered(user, 2, expectedOrangeSecured);
        vault.triggerProtection(2); // Orange

        assertEq(vault.securedAmount(user), expectedOrangeSecured, "Orange should secure 50%");
        assertEq(vault.protectionLevel(user), 50, "Orange protection level should be 50");

        // ── Step 7: Push price to Red (>35%) ────────────────────────────
        {
            vm.prank(trader);
            market.buyRisk(10_000 * USDC_UNIT); // ~62 % → Red
            priceAfterBuy = market.getCurrentRiskPrice();
        }

        assertGt(priceAfterBuy, 35, "Price should be above Orange max");
        assertEq(uint8(market.currentZone()), 3); // Red

        // CRE workflow triggers Red protection
        uint256 remainingUnsecured = depositAfterPremium - expectedOrangeSecured;

        vm.expectEmit(true, false, false, true);
        emit ShieldVault.ProtectionTriggered(user, 3, remainingUnsecured);
        vault.triggerProtection(3); // Red

        assertEq(vault.securedAmount(user), depositAfterPremium, "Red should secure 100%");
        assertEq(vault.protectionLevel(user), 100, "Red protection level should be 100");

        // ── Step 8: Insurance claim ─────────────────────────────────────
        uint256 lossAmount = depositAfterPremium; // Full loss
        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 poolBalanceBefore = pool.totalPoolBalance();

        vm.expectEmit(true, false, false, true);
        emit ShieldVault.InsuranceClaimed(user, lossAmount);
        vault.processInsuranceClaim(user, lossAmount);

        // User received payout from InsurancePool
        assertEq(usdc.balanceOf(user), userUsdcBefore + lossAmount, "User should receive claim");

        // Pool balance decreased
        assertEq(pool.totalPoolBalance(), poolBalanceBefore - lossAmount, "Pool balance should decrease");
        assertEq(pool.totalClaimsPaid(), lossAmount, "Claims paid should match");

        // SecuredAmount reset after full claim
        assertEq(vault.securedAmount(user), 0, "Secured amount should be zero after claim");
        assertEq(vault.protectionLevel(user), 0, "Protection level should reset after full claim");

        // ── Step 9: Final verification ──────────────────────────────────
        // Pool health should reflect the claim.
        // Note: premium was sent via safeTransfer (not receivePremium), so
        // totalPoolBalance does NOT include it — only LP deposits minus claims.
        (uint256 totalLiquidity,,uint256 claimsPaid, uint256 utilization,) = pool.getPoolHealth();
        assertEq(totalLiquidity, LP_DEPOSIT - lossAmount);
        assertEq(claimsPaid, lossAmount);
        assertGt(utilization, 0, "Utilization should be > 0 after claims");

        // LP value tracks totalPoolBalance (LP deposits minus claims).
        // The premium sits in the pool's USDC balance but not in totalPoolBalance.
        (,, uint256 lpValue,) = pool.getLPPosition(lp);
        assertEq(lpValue, LP_DEPOSIT - lossAmount);

        // User's shield is still active (can be deactivated by user)
        assertTrue(vault.shieldActive(user));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Zone Transition Events
    // ══════════════════════════════════════════════════════════════════════

    function test_ZoneTransitionEvents() public {
        market.setVerificationStatus(trader, true);

        // Green → Yellow
        vm.expectEmit(false, false, false, false);
        emit RiskMarket.ZoneChanged(0, 1, 0);
        vm.prank(trader);
        market.buyRisk(2_500 * USDC_UNIT);
        assertEq(uint8(market.currentZone()), 1);

        // Yellow → Orange
        vm.expectEmit(false, false, false, false);
        emit RiskMarket.ZoneChanged(1, 2, 0);
        vm.prank(trader);
        market.buyRisk(3_500 * USDC_UNIT);
        assertEq(uint8(market.currentZone()), 2);

        // Orange → Red
        vm.expectEmit(false, false, false, false);
        emit RiskMarket.ZoneChanged(2, 3, 0);
        vm.prank(trader);
        market.buyRisk(10_000 * USDC_UNIT);
        assertEq(uint8(market.currentZone()), 3);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Idempotent Protection Triggers
    // ══════════════════════════════════════════════════════════════════════

    function test_IdempotentProtection() public {
        // Setup: LP deposits, user shields
        vm.prank(lp);
        pool.depositLiquidity(LP_DEPOSIT);

        gate.mockVerify(user);

        vm.prank(user);
        vault.deposit(USER_DEPOSIT);
        vm.prank(user);
        vault.activateShield(address(0xBEEF));

        uint256 depositAfterPremium = vault.deposits(user);

        // Push to Orange and trigger
        market.setVerificationStatus(trader, true);
        vm.prank(trader);
        market.buyRisk(200_000 * USDC_UNIT);

        vault.triggerProtection(2); // Orange
        uint256 secured1 = vault.securedAmount(user);
        assertEq(secured1, depositAfterPremium / 2);

        // Trigger Orange again — should be idempotent (no additional securing)
        vault.triggerProtection(2);
        assertEq(vault.securedAmount(user), secured1, "Second Orange trigger should be idempotent");
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Insurance Claim Capped at Secured Amount
    // ══════════════════════════════════════════════════════════════════════

    function test_ClaimCappedAtSecuredAmount() public {
        vm.prank(lp);
        pool.depositLiquidity(LP_DEPOSIT);

        gate.mockVerify(user);

        vm.prank(user);
        vault.deposit(USER_DEPOSIT);
        vm.prank(user);
        vault.activateShield(address(0xBEEF));

        // Push to Orange (50% secured)
        market.setVerificationStatus(trader, true);
        vm.prank(trader);
        market.buyRisk(200_000 * USDC_UNIT);
        vault.triggerProtection(2);

        uint256 secured = vault.securedAmount(user);
        uint256 userBalBefore = usdc.balanceOf(user);

        // Claim more than secured — should cap at secured
        vault.processInsuranceClaim(user, secured * 2);
        assertEq(usdc.balanceOf(user), userBalBefore + secured, "Claim should be capped");
    }

    // ══════════════════════════════════════════════════════════════════════
    //  World ID Required for Shield Activation
    // ══════════════════════════════════════════════════════════════════════

    function test_ShieldRequiresWorldId() public {
        address unverified = makeAddr("unverified");
        usdc.mint(unverified, 10_000 * USDC_UNIT);

        vm.startPrank(unverified);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(5_000 * USDC_UNIT);

        vm.expectRevert(ShieldVault.NotVerified.selector);
        vault.activateShield(address(0xBEEF));
        vm.stopPrank();
    }
}
