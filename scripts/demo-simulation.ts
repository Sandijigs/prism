import { ethers, BigNumber } from "ethers";
import chalk from "chalk";
import * as dotenv from "dotenv";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

// ── Load environment ────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ── ABIs (minimal fragments) ────────────────────────────────────────────────

const RISK_MARKET_ABI = [
  "function getCurrentRiskPrice() view returns (uint256)",
  "function getCurrentZone() view returns (uint8)",
  "function riskPool() view returns (uint256)",
  "function usdcPool() view returns (uint256)",
  "function invariant() view returns (uint256)",
  "function totalRiskMinted() view returns (uint256)",
  "function totalUsdcDeposited() view returns (uint256)",
  "function resolved() view returns (bool)",
  "function isVerified(address) view returns (bool)",
  "function getMarketInfo() view returns (tuple(uint256,uint8,uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256,uint256,uint256))",
  "function buyRisk(uint256 usdcAmount) returns (uint256)",
  "function setVerificationStatus(address,bool)",
  "event ZoneChanged(uint8 previousZone, uint8 newZone, uint256 riskPrice)",
  "event TradeExecuted(address indexed trader, bool isBuy, uint256 amount, uint256 newPrice)",
];

const SHIELD_VAULT_ABI = [
  "function deposits(address) view returns (uint256)",
  "function shieldActive(address) view returns (bool)",
  "function protectionLevel(address) view returns (uint256)",
  "function securedAmount(address) view returns (uint256)",
  "function shieldedUserCount() view returns (uint256)",
  "function triggerProtection(uint8 zone)",
  "event ProtectionTriggered(address indexed user, uint8 zone, uint256 amountSecured)",
];

const INSURANCE_POOL_ABI = [
  "function totalPoolBalance() view returns (uint256)",
  "function totalPremiumsCollected() view returns (uint256)",
  "function totalClaimsPaid() view returns (uint256)",
  "function currentUtilizationBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "function getPoolHealth() view returns (uint256,uint256,uint256,uint256,bool)",
  "function requestPayout(address user, uint256 amount)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// ── Constants ───────────────────────────────────────────────────────────────

const SCALE = BigNumber.from("1000000000000000000"); // 1e18
const USDC_SCALE = BigNumber.from("1000000"); // 1e6
const PRICE_SCALE = 100;
const ZONE_NAMES = ["GREEN", "YELLOW", "ORANGE", "RED"];
const ZONE_ICONS = ["🟢", "🟡", "🟠", "🔴"];
const ZONE_COLORS = [chalk.green, chalk.yellow, chalk.hex("#F4A261"), chalk.red];

// ── Types ───────────────────────────────────────────────────────────────────

interface Deployment {
  contracts: {
    mockUSDC: string;
    riskMarket: string;
    insurancePool: string;
    shieldVault: string;
    worldIDGate: string;
    prismToken: string;
  };
  rpc: string;
  adminRpc: string;
  deployer: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function box(lines: string[], color: chalk.Chalk = chalk.cyan): string {
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length));
  const pad = (s: string) => s + " ".repeat(maxLen - stripAnsi(s).length);
  const top = color("╔═" + "═".repeat(maxLen) + "═╗");
  const bot = color("╚═" + "═".repeat(maxLen) + "═╝");
  const mid = lines.map((l) => color("║ ") + pad(l) + color(" ║")).join("\n");
  return `${top}\n${mid}\n${bot}`;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEnter(rl: readline.Interface, prompt = "Press ENTER to continue..."): Promise<void> {
  return new Promise((resolve) => {
    rl.question(chalk.dim(`\n  ⏎  ${prompt}\n`), () => resolve());
  });
}

function fmtUsdc(raw: BigNumber): string {
  const val = parseFloat(ethers.utils.formatUnits(raw, 6));
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

function logStep(icon: string, msg: string) {
  console.log(`  ${icon} ${msg}`);
}

/**
 * Calculate USDC needed (6-decimal) to push the AMM price to `targetPrice` (integer %).
 * Uses constant-product formula:
 *   new_usdcPool = sqrt(k * P / (100 - P))
 *   scaledIn = new_usdcPool - current_usdcPool
 *   usdcAmount = scaledIn * USDC_SCALE / SCALE
 */
function calcUsdcForTargetPrice(
  usdcPool: BigNumber,
  riskPool: BigNumber,
  targetPrice: number,
): BigNumber {
  // Work in floating point for sqrt, then convert back
  const k = parseFloat(ethers.utils.formatUnits(usdcPool.mul(riskPool), 36)); // k in float
  const usdcPoolF = parseFloat(ethers.utils.formatUnits(usdcPool, 18));
  const P = targetPrice;

  // new_usdcPool = sqrt(k * P / (100 - P))
  const newUsdcPoolF = Math.sqrt((k * P) / (PRICE_SCALE - P));
  const deltaF = newUsdcPoolF - usdcPoolF;

  if (deltaF <= 0) return BigNumber.from(0);

  // Convert to 6-decimal USDC amount + 5% buffer for rounding/weight
  const usdcAmount = Math.ceil(deltaF * 1.05 * 1e6);
  return BigNumber.from(usdcAmount.toString());
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── Load deployment config ──
  const deployPath = path.resolve(__dirname, "../[pok/deployments.json");
  if (!fs.existsSync(deployPath)) {
    console.error(chalk.red("✗ Cannot find deployments.json at: " + deployPath));
    console.error(chalk.dim("  Make sure contracts are deployed first."));
    process.exit(1);
  }
  const deploy: Deployment = JSON.parse(fs.readFileSync(deployPath, "utf-8"));

  const rpcUrl = process.env.RPC_URL || deploy.rpc;
  const privateKey = process.env.PRIVATE_KEY || "";

  if (!privateKey) {
    console.error(chalk.red("✗ PRIVATE_KEY not set in .env"));
    console.error(chalk.dim("  Create a .env file with PRIVATE_KEY=0x..."));
    process.exit(1);
  }

  // ── Connect ──
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  const riskMarket = new ethers.Contract(deploy.contracts.riskMarket, RISK_MARKET_ABI, wallet);
  const shieldVault = new ethers.Contract(deploy.contracts.shieldVault, SHIELD_VAULT_ABI, wallet);
  const insurancePool = new ethers.Contract(deploy.contracts.insurancePool, INSURANCE_POOL_ABI, wallet);
  const usdc = new ethers.Contract(deploy.contracts.mockUSDC, ERC20_ABI, wallet);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ── Read initial state ──
  let price: number;
  let zone: number;
  let shieldCount: BigNumber;
  let poolBalance: BigNumber;

  try {
    price = (await riskMarket.getCurrentRiskPrice()).toNumber();
    zone = (await riskMarket.getCurrentZone()) as number;
    shieldCount = await shieldVault.shieldedUserCount();
    poolBalance = await insurancePool.totalPoolBalance();
  } catch (err) {
    console.error(chalk.red("✗ Failed to read contract state. Are contracts deployed?"));
    console.error(chalk.dim(`  Error: ${err}`));
    rl.close();
    process.exit(1);
  }

  // ── Ensure USDC approval ──
  const approvalNeeded = ethers.utils.parseUnits("1000000", 6); // 1M USDC
  const currentAllowance: BigNumber = await usdc.allowance(wallet.address, deploy.contracts.riskMarket);
  if (currentAllowance.lt(approvalNeeded)) {
    logStep("🔑", "Approving USDC for RiskMarket...");
    const tx = await usdc.approve(deploy.contracts.riskMarket, ethers.constants.MaxUint256);
    await tx.wait();
    logStep("✓", "USDC approved");
  }

  // ── Ensure wallet is verified for full price impact ──
  try {
    const verified = await riskMarket.isVerified(wallet.address);
    if (!verified) {
      logStep("🔑", "Setting wallet as World ID verified for full trade impact...");
      const tx = await riskMarket.setVerificationStatus(wallet.address, true);
      await tx.wait();
      logStep("✓", "Wallet verified");
    }
  } catch {
    // Not owner — that's fine, trades will work with reduced weight
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETUP DISPLAY
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n");
  console.log(
    box(
      [
        chalk.bold("PRISM Protocol — Demo Simulation"),
        "",
        `Network: ${chalk.cyan(`Chain ${network.chainId}`)}`,
        `RiskMarket: ${chalk.dim(deploy.contracts.riskMarket)}`,
        `ShieldVault: ${chalk.dim(deploy.contracts.shieldVault)}`,
        `InsurancePool: ${chalk.dim(deploy.contracts.insurancePool)}`,
        "",
        `Current Zone: ${ZONE_ICONS[zone]} ${ZONE_COLORS[zone](ZONE_NAMES[zone])}`,
        `Risk Price: ${chalk.bold(price + "%")}`,
        `Shield Users: ${chalk.bold(shieldCount.toString())} active`,
        `Insurance Pool: ${chalk.bold(fmtUsdc(poolBalance))}`,
      ],
      chalk.cyan,
    ),
  );

  await waitForEnter(rl, "Press ENTER to begin the demo...");

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — AI Agent detects TVL anomaly → push into YELLOW (>5%)
  // ══════════════════════════════════════════════════════════════════════════

  console.log(chalk.bold.white("\n━━━ STEP 1: AI Agent detects TVL anomaly ━━━\n"));

  logStep("🔍", "AI Risk Agent analyzing protocol metrics...");
  await sleep(2000);

  logStep("📉", chalk.yellow("TVL dropped 7.3% in last 24 hours"));
  await sleep(1000);
  logStep("🤖", "AI Assessment: " + chalk.bold("Risk Score 12/100") + ", Confidence 78%");
  await sleep(1000);

  // Calculate amount to push to ~8% (safely into Yellow)
  const TARGET_YELLOW = 8;
  let pools = { usdc: await riskMarket.usdcPool(), risk: await riskMarket.riskPool() };
  let buyAmount = calcUsdcForTargetPrice(pools.usdc, pools.risk, TARGET_YELLOW);

  if (buyAmount.gt(0)) {
    logStep("💹", `Executing trade: Buying RISK with ${fmtUsdc(buyAmount)} USDC...`);
    try {
      const tx = await riskMarket.buyRisk(buyAmount);
      const receipt = await tx.wait();
      logStep("✓", chalk.green("Trade executed — tx: " + receipt.transactionHash.slice(0, 18) + "..."));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ Trade failed: ${err.reason || err.message}`));
      console.log(chalk.dim("    Continuing with demo..."));
    }
  }

  price = (await riskMarket.getCurrentRiskPrice()).toNumber();
  zone = (await riskMarket.getCurrentZone()) as number;

  console.log("");
  logStep("📊", `New Risk Price: ${chalk.bold(price + "%")}`);
  logStep(ZONE_ICONS[zone], ZONE_COLORS[zone](`ZONE: ${ZONE_NAMES[zone]}`));
  if (zone >= 1) {
    console.log(chalk.yellow.bold("\n  ⚠️  ZONE CHANGE: GREEN → YELLOW\n"));
  }

  await waitForEnter(rl);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Multiple signals → push into ORANGE (>15%)
  // ══════════════════════════════════════════════════════════════════════════

  console.log(chalk.bold.white("\n━━━ STEP 2: Multiple risk signals detected ━━━\n"));

  logStep("🔍", "AI Agent detects unusual admin key activity...");
  await sleep(1500);
  logStep("📰", chalk.yellow('News API: "Security vulnerability reported in protocol audit"'));
  await sleep(1500);
  logStep("🤖", "AI Assessment: " + chalk.bold("Risk Score 28/100") + ", Confidence 85%");
  await sleep(1000);

  // Calculate amount to push to ~22% (safely into Orange)
  const TARGET_ORANGE = 22;
  pools = { usdc: await riskMarket.usdcPool(), risk: await riskMarket.riskPool() };
  buyAmount = calcUsdcForTargetPrice(pools.usdc, pools.risk, TARGET_ORANGE);

  if (buyAmount.gt(0)) {
    logStep("💹", `Executing trade: Buying RISK with ${fmtUsdc(buyAmount)} USDC...`);
    try {
      const tx = await riskMarket.buyRisk(buyAmount);
      const receipt = await tx.wait();
      logStep("✓", chalk.green("Trade executed — tx: " + receipt.transactionHash.slice(0, 18) + "..."));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ Trade failed: ${err.reason || err.message}`));
      console.log(chalk.dim("    Continuing with demo..."));
    }
  }

  price = (await riskMarket.getCurrentRiskPrice()).toNumber();
  zone = (await riskMarket.getCurrentZone()) as number;

  console.log("");
  logStep("📊", `New Risk Price: ${chalk.bold(price + "%")}`);
  logStep(ZONE_ICONS[zone], ZONE_COLORS[zone](`ZONE: ${ZONE_NAMES[zone]}`));

  if (zone >= 2) {
    console.log(chalk.hex("#F4A261").bold("\n  🟠 ZONE CHANGE: YELLOW → ORANGE\n"));

    logStep("🛡️", chalk.bold("Threshold Controller activated!"));
    await sleep(1000);

    try {
      logStep("⚡", "Calling ShieldVault.triggerProtection(2)...");
      const tx = await shieldVault.triggerProtection(2);
      const receipt = await tx.wait();
      logStep("✓", chalk.green("Protection triggered — 50% of shielded funds secured"));
      logStep("📋", chalk.dim("tx: " + receipt.transactionHash.slice(0, 18) + "..."));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ triggerProtection failed: ${err.reason || err.message}`));
      console.log(chalk.dim("    Owner/CRE authorization may be required."));
    }
  }

  await waitForEnter(rl);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Critical threat confirmed → push into RED (>35%)
  // ══════════════════════════════════════════════════════════════════════════

  console.log(chalk.bold.white("\n━━━ STEP 3: Critical threat confirmed ━━━\n"));

  logStep("🚨", chalk.red("Security researcher confirms active exploit"));
  await sleep(1500);
  logStep("🤖", "AI Assessment: " + chalk.bold("Risk Score 65/100") + ", Confidence 95%");
  await sleep(1000);
  logStep("💹", "Multiple agents buying RISK...");
  await sleep(1000);

  // Calculate amount to push to ~42% (safely into Red)
  const TARGET_RED = 42;
  pools = { usdc: await riskMarket.usdcPool(), risk: await riskMarket.riskPool() };
  buyAmount = calcUsdcForTargetPrice(pools.usdc, pools.risk, TARGET_RED);

  if (buyAmount.gt(0)) {
    logStep("💹", `Executing trade: Buying RISK with ${fmtUsdc(buyAmount)} USDC...`);
    try {
      const tx = await riskMarket.buyRisk(buyAmount);
      const receipt = await tx.wait();
      logStep("✓", chalk.green("Trade executed — tx: " + receipt.transactionHash.slice(0, 18) + "..."));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ Trade failed: ${err.reason || err.message}`));
      console.log(chalk.dim("    Continuing with demo..."));
    }
  }

  price = (await riskMarket.getCurrentRiskPrice()).toNumber();
  zone = (await riskMarket.getCurrentZone()) as number;

  console.log("");
  logStep("📊", `New Risk Price: ${chalk.bold(price + "%")}`);
  logStep(ZONE_ICONS[zone], ZONE_COLORS[zone](`ZONE: ${ZONE_NAMES[zone]}`));

  if (zone >= 3) {
    console.log(chalk.red.bold("\n  🔴 ZONE CHANGE: ORANGE → RED\n"));
    console.log(chalk.red.bold("  🚨 EMERGENCY PROTOCOL ACTIVATED 🚨\n"));
    await sleep(1000);

    try {
      logStep("⚡", "Calling ShieldVault.triggerProtection(3)...");
      const tx = await shieldVault.triggerProtection(3);
      const receipt = await tx.wait();
      logStep("✓", chalk.green("Protection triggered — 100% of shielded funds secured"));
      logStep("📋", chalk.dim("tx: " + receipt.transactionHash.slice(0, 18) + "..."));
    } catch (err: any) {
      console.log(chalk.red(`  ✗ triggerProtection failed: ${err.reason || err.message}`));
    }

    logStep("🏦", "Insurance pool activated for claims");
  }

  await waitForEnter(rl);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Resolution
  // ══════════════════════════════════════════════════════════════════════════

  console.log(chalk.bold.white("\n━━━ STEP 4: Resolution ━━━\n"));

  logStep("📋", "Processing insurance claims...");
  await sleep(2000);

  // Read final state
  let finalPoolBalance: BigNumber;
  let totalClaims: BigNumber;
  try {
    finalPoolBalance = await insurancePool.totalPoolBalance();
    totalClaims = await insurancePool.totalClaimsPaid();
  } catch {
    finalPoolBalance = poolBalance;
    totalClaims = BigNumber.from(0);
  }

  const finalPrice = (await riskMarket.getCurrentRiskPrice()).toNumber();

  console.log("\n");
  console.log(
    box(
      [
        chalk.bold.green("PROTECTION COMPLETE"),
        "",
        `First warning → Full protection: ${chalk.bold("~3 min")}`,
        `Traditional governance vote:     ${chalk.bold.red("3–7 DAYS")}`,
        "",
        `Final Risk Price: ${chalk.bold(finalPrice + "%")}`,
        `Insurance Pool:   ${chalk.bold(fmtUsdc(finalPoolBalance))}`,
        `Claims Paid:      ${chalk.bold(fmtUsdc(totalClaims))}`,
        "",
        `User deposit:  $10,000`,
        `Protected:     $10,000 ${chalk.green("✓")}`,
        `Premium paid:  $50`,
        "",
        chalk.bold.cyan("PRISM: DeFi's Immune System 🛡️"),
      ],
      chalk.green,
    ),
  );

  console.log("\n");
  rl.close();
}

main().catch((err) => {
  console.error(chalk.red("\n✗ Fatal error:"), err.message);
  process.exit(1);
});
