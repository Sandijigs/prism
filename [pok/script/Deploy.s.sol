// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { RiskMarket } from "../src/RiskMarket.sol";
import { ShieldVault } from "../src/ShieldVault.sol";
import { InsurancePool } from "../src/InsurancePool.sol";
import { WorldIDGate } from "../src/WorldIDGate.sol";
import { IWorldID } from "../src/interfaces/IWorldID.sol";
import { PRISMToken } from "../src/PRISMToken.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ── Mock USDC for testnet deployments (6 decimals, open mint) ────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

// ── Deployment Script ────────────────────────────────────────────────────
//
//  Usage:
//
//    # Tenderly Virtual TestNet
//    forge script script/Deploy.s.sol:DeployPRISM \
//      --rpc-url $TENDERLY_RPC_URL --broadcast --slow
//
//    # Sepolia
//    forge script script/Deploy.s.sol:DeployPRISM \
//      --rpc-url $SEPOLIA_RPC_URL --broadcast --verify \
//      --etherscan-api-key $ETHERSCAN_API_KEY
//

contract DeployPRISM is Script {
    // ── Parameters ───────────────────────────────────────────────────────

    uint256 constant INITIAL_LIQUIDITY = 100_000;
    uint256 constant INITIAL_PRICE = 2; // 2 %
    uint256 constant MARKET_DURATION = 30 days;
    uint256 constant MAX_UTILIZATION_BPS = 8_000; // 80 %
    uint256 constant USDC_UNIT = 1e6;

    // ── Run ──────────────────────────────────────────────────────────────

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== PRISM Protocol Deployment ===");
        console.log("Deployer :", deployer);
        console.log("Chain ID :", block.chainid);
        console.log("");

        vm.startBroadcast(deployerKey);

        // ── 1. MockUSDC ──────────────────────────────────────────────────

        MockUSDC usdc = new MockUSDC();
        console.log("[1/6] MockUSDC     :", address(usdc));

        // ── 2. RiskMarket ────────────────────────────────────────────────

        RiskMarket riskMarket = new RiskMarket(
            address(usdc),
            INITIAL_LIQUIDITY,
            INITIAL_PRICE,
            MARKET_DURATION
        );
        console.log("[2/6] RiskMarket   :", address(riskMarket));

        // ── 3. InsurancePool ─────────────────────────────────────────────

        InsurancePool insurancePool = new InsurancePool(
            address(usdc),
            MAX_UTILIZATION_BPS
        );
        console.log("[3/6] InsurancePool:", address(insurancePool));

        // ── 4. ShieldVault ───────────────────────────────────────────────

        ShieldVault shieldVault = new ShieldVault(
            address(usdc),
            address(riskMarket),
            address(insurancePool)
        );
        console.log("[4/6] ShieldVault  :", address(shieldVault));

        // ── 5. WorldIDGate (mock mode) ───────────────────────────────────

        WorldIDGate worldIdGate = new WorldIDGate(
            IWorldID(address(0)),       // No live World ID Router on test chains
            "app_prism_protocol",       // App ID
            "prism-verify",             // Action ID
            1                           // Group ID (Orb)
        );
        console.log("[5/6] WorldIDGate  :", address(worldIdGate));

        // ── 6. PRISMToken ────────────────────────────────────────────────

        PRISMToken prismToken = new PRISMToken();
        console.log("[6/6] PRISMToken   :", address(prismToken));

        // ── Cross-Contract Wiring ────────────────────────────────────────

        console.log("");
        console.log("Wiring cross-contract references...");

        // RiskMarket references
        riskMarket.setWorldIdGate(address(worldIdGate));
        riskMarket.setCreWorkflow(deployer);

        // ShieldVault references
        shieldVault.setWorldIdGate(address(worldIdGate));
        shieldVault.setCreWorkflow(deployer);

        // InsurancePool references
        insurancePool.setShieldVault(address(shieldVault));
        insurancePool.setCreWorkflow(deployer);

        // WorldIDGate references (owner == deployer, so creWorkflow not strictly needed)
        worldIdGate.setRiskMarket(address(riskMarket));
        worldIdGate.setMockMode(true);

        // ── Mint Test USDC & Seed Liquidity ──────────────────────────────

        console.log("Minting 10M test USDC to deployer...");
        usdc.mint(deployer, 10_000_000 * USDC_UNIT);

        // Approve RiskMarket for deployer trading (before pool seeding to prioritize)
        usdc.approve(address(riskMarket), type(uint256).max);

        console.log("Seeding InsurancePool with 500K USDC...");
        usdc.approve(address(insurancePool), 500_000 * USDC_UNIT);
        insurancePool.depositLiquidity(500_000 * USDC_UNIT);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
    }
}
