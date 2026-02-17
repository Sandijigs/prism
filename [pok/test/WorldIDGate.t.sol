// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskMarket} from "../src/RiskMarket.sol";
import {WorldIDGate} from "../src/WorldIDGate.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
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

contract WorldIDGateTest is Test {
    WorldIDGate public gate;
    RiskMarket public market;
    MockUSDC public usdc;

    address public deployer;
    address public workflow = makeAddr("creWorkflow");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public stranger = makeAddr("stranger");

    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;
    address constant SOURCE_ADDR = address(0xCAFE);

    function setUp() public {
        deployer = address(this);

        usdc = new MockUSDC();
        market = new RiskMarket(address(usdc), 100_000, 2, 30 days);
        gate = new WorldIDGate(IWorldID(address(0)), "app_prism", "prism-verify", 1);

        // Wire contracts
        gate.setRiskMarket(address(market));
        gate.setMockMode(true);
        gate.setCreWorkflow(workflow);

        market.setWorldIdGate(address(gate));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Cross-Chain Verification — Success
    // ══════════════════════════════════════════════════════════════════════

    function test_verifyCrossChain_success() public {
        vm.prank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);

        // User is verified
        assertTrue(gate.verified(alice));
        assertTrue(gate.isVerified(alice));

        // Cross-chain data stored
        (uint64 selector, address srcAddr, uint256 ts, bool valid) = gate.crossChainVerifications(alice);
        assertEq(selector, SEPOLIA_SELECTOR);
        assertEq(srcAddr, SOURCE_ADDR);
        assertGt(ts, 0);
        assertTrue(valid);

        // Total verified incremented
        assertEq(gate.totalVerified(), 1);
    }

    function test_verifyCrossChain_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit WorldIDGate.CrossChainVerified(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);

        vm.prank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
    }

    function test_verifyCrossChain_emitsUserVerified() public {
        vm.expectEmit(true, false, false, false);
        emit WorldIDGate.UserVerified(alice);

        vm.prank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Cross-Chain Verification — Access Control
    // ══════════════════════════════════════════════════════════════════════

    function test_verifyCrossChain_onlyCREWorkflow() public {
        vm.prank(stranger);
        vm.expectRevert(WorldIDGate.NotAuthorized.selector);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
    }

    function test_verifyCrossChain_ownerCannotCall() public {
        // Even the owner cannot call — only creWorkflow
        vm.expectRevert(WorldIDGate.NotAuthorized.selector);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Cross-Chain Verification — Edge Cases
    // ══════════════════════════════════════════════════════════════════════

    function test_verifyCrossChain_zeroAddress() public {
        vm.prank(workflow);
        vm.expectRevert(WorldIDGate.ZeroAddress.selector);
        gate.verifyCrossChain(address(0), SEPOLIA_SELECTOR, SOURCE_ADDR);
    }

    function test_verifyCrossChain_propagatesToRiskMarket() public {
        vm.prank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);

        assertTrue(market.isVerified(alice));
    }

    function test_verifyCrossChain_idempotent() public {
        vm.startPrank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
        vm.stopPrank();

        // totalVerified should only count once
        assertEq(gate.totalVerified(), 1);
        assertTrue(gate.verified(alice));
    }

    function test_verifyCrossChain_updatesExistingRecord() public {
        uint64 altSelector = 4949039107694359620; // Arbitrum Sepolia

        vm.startPrank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
        gate.verifyCrossChain(alice, altSelector, address(0xBEEF));
        vm.stopPrank();

        // Should reflect the latest cross-chain data
        (uint64 selector, address srcAddr,,) = gate.crossChainVerifications(alice);
        assertEq(selector, altSelector);
        assertEq(srcAddr, address(0xBEEF));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  totalVerified Counter
    // ══════════════════════════════════════════════════════════════════════

    function test_totalVerified_incrementsAcrossMethods() public {
        // Mock verify alice
        gate.mockVerify(alice);
        assertEq(gate.totalVerified(), 1);

        // Cross-chain verify bob
        vm.prank(workflow);
        gate.verifyCrossChain(bob, SEPOLIA_SELECTOR, SOURCE_ADDR);
        assertEq(gate.totalVerified(), 2);
    }

    function test_totalVerified_noDoubleCountMockThenCrossChain() public {
        // Mock verify alice first
        gate.mockVerify(alice);
        assertEq(gate.totalVerified(), 1);

        // Cross-chain verify same alice — should not increment
        vm.prank(workflow);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
        assertEq(gate.totalVerified(), 1);
    }

    function test_totalVerified_noDoubleCountOnDoubleMock() public {
        gate.mockVerify(alice);
        gate.mockVerify(alice); // idempotent
        assertEq(gate.totalVerified(), 1);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Modifier — onlyCREWorkflow
    // ══════════════════════════════════════════════════════════════════════

    function test_onlyCREWorkflow_setCreWorkflow() public {
        address newWorkflow = makeAddr("newWorkflow");
        gate.setCreWorkflow(newWorkflow);

        vm.prank(newWorkflow);
        gate.verifyCrossChain(bob, SEPOLIA_SELECTOR, SOURCE_ADDR);
        assertTrue(gate.verified(bob));
    }

    function test_onlyCREWorkflow_oldWorkflowReverts() public {
        address newWorkflow = makeAddr("newWorkflow");
        gate.setCreWorkflow(newWorkflow);

        // Old workflow should now be rejected
        vm.prank(workflow);
        vm.expectRevert(WorldIDGate.NotAuthorized.selector);
        gate.verifyCrossChain(alice, SEPOLIA_SELECTOR, SOURCE_ADDR);
    }
}
