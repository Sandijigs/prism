/**
 * Reserve Verifier Workflow
 *
 * Periodically verifies that the InsurancePool has sufficient reserves to back
 * active Shield Mode coverage. Fetches real protocol TVL, reads pool health,
 * calculates solvency ratios, and takes protective action if reserves are low.
 *
 * Pattern: cron trigger -> HTTP fetch (TVL) -> EVM read (pool health) -> verify -> EVM write (if needed)
 */

import {
	CronCapability,
	consensusMedianAggregation,
	EVMClient,
	HTTPClient,
	type HTTPSendRequester,
	encodeCallMsg,
	getNetwork,
	handler,
	LATEST_BLOCK_NUMBER,
	ok,
	prepareReportRequest,
	Runner,
	type Runtime,
	text,
	TxStatus,
	bytesToHex,
} from "@chainlink/cre-sdk";
import {
	type Address,
	decodeFunctionResult,
	encodeFunctionData,
	zeroAddress,
} from "viem";
import { z } from "zod";

// ── Config ──────────────────────────────────────────────────────────────

const configSchema = z.object({
	schedule: z.string(),
	riskMarketAddress: z.string(),
	insurancePoolAddress: z.string(),
	chainRpcUrl: z.string(),
	chainSelectorName: z.string(),
	defiLlamaApiUrl: z.string(),
	monitoredProtocol: z.string(),
	gasLimit: z.string().optional(),
});

type Config = z.infer<typeof configSchema>;

// ── InsurancePool ABI ───────────────────────────────────────────────────

const INSURANCE_POOL_ABI = [
	{
		name: "getPoolHealth",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [
			{ name: "totalLiquidity", type: "uint256" },
			{ name: "premiumsCollected", type: "uint256" },
			{ name: "claimsPaid", type: "uint256" },
			{ name: "utilizationRatio", type: "uint256" },
			{ name: "isPaused", type: "bool" },
		],
	},
	{
		name: "pauseNewShields",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [],
		outputs: [],
	},
] as const;

// ── Constants ───────────────────────────────────────────────────────────

const SOLVENCY_WARNING_THRESHOLD = 1.5; // Warn if ratio < 1.5x
const SOLVENCY_CRITICAL_THRESHOLD = 1.0; // Pause if ratio < 1.0x
const BPS = 10000;

// ── HTTP: Fetch TVL from DeFiLlama ──────────────────────────────────────

const fetchProtocolTvl = (
	sendRequester: HTTPSendRequester,
	config: Config,
): number => {
	const url = `${config.defiLlamaApiUrl}/tvl/${config.monitoredProtocol}`;
	const response = sendRequester
		.sendRequest({ url, method: "GET" })
		.result();

	if (!ok(response)) {
		throw new Error(
			`DeFiLlama API failed (${response.statusCode}) for ${config.monitoredProtocol}`,
		);
	}

	const tvlText = text(response);
	const tvl = Number.parseFloat(tvlText);

	if (Number.isNaN(tvl)) {
		throw new Error(`Invalid TVL response: ${tvlText}`);
	}

	return tvl;
};

// ── Pool Health Types ───────────────────────────────────────────────────

type PoolHealth = {
	totalLiquidity: bigint;
	premiumsCollected: bigint;
	claimsPaid: bigint;
	utilizationRatio: bigint;
	isPaused: boolean;
};

type VerificationStatus = "HEALTHY" | "WARNING" | "CRITICAL";

// ── Main Handler ────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>) => {
	const config = runtime.config;

	runtime.log("=== Reserve Verifier: Pool Solvency Check ===");

	// ── 1. Fetch protocol TVL from DeFiLlama ────────────────────────
	let protocolTvl: number;
	try {
		const httpClient = new HTTPClient();
		protocolTvl = httpClient
			.sendRequest(runtime, fetchProtocolTvl, consensusMedianAggregation())(
				config,
			)
			.result();
		runtime.log(`Protocol TVL: $${(protocolTvl / 1e9).toFixed(2)}B`);
	} catch (err) {
		runtime.log(`TVL fetch failed: ${String(err)}. Using default 0.`);
		protocolTvl = 0;
	}

	// ── 2. Set up EVM client ─────────────────────────────────────────
	const network = getNetwork({
		chainFamily: "evm",
		chainSelectorName: config.chainSelectorName,
		isTestnet: true,
	});

	if (!network) {
		runtime.log(`Network not found: ${config.chainSelectorName}. Skipping.`);
		return { action: "skip", reason: "network_not_found" };
	}

	const evmClient = new EVMClient(network.chainSelector.selector);

	// ── 3. Read InsurancePool health ────────────────────────────────
	let poolHealth: PoolHealth = {
		totalLiquidity: 0n,
		premiumsCollected: 0n,
		claimsPaid: 0n,
		utilizationRatio: 0n,
		isPaused: false,
	};

	try {
		const callData = encodeFunctionData({
			abi: INSURANCE_POOL_ABI,
			functionName: "getPoolHealth",
		});

		const result = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: config.insurancePoolAddress as Address,
					data: callData,
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result();

		const decoded = decodeFunctionResult({
			abi: INSURANCE_POOL_ABI,
			functionName: "getPoolHealth",
			data: bytesToHex(result.data),
		});

		poolHealth = {
			totalLiquidity: decoded[0],
			premiumsCollected: decoded[1],
			claimsPaid: decoded[2],
			utilizationRatio: decoded[3],
			isPaused: decoded[4],
		};

		runtime.log(
			`Pool Health: Liquidity=$${Number(poolHealth.totalLiquidity) / 1e6} USDC, ` +
				`Utilization=${Number(poolHealth.utilizationRatio)}bps (${(Number(poolHealth.utilizationRatio) / 100).toFixed(1)}%)`,
		);
	} catch (err) {
		runtime.log(
			`On-chain read failed (contract may not exist on simulation chain): ${String(err)}`,
		);
		runtime.log("Using default pool health: 0 liquidity");
	}

	// ── 4. Calculate solvency ratio ─────────────────────────────────
	// Solvency ratio = totalLiquidity / maxExpectedClaim
	// maxExpectedClaim ≈ totalLiquidity * utilizationRatio / BPS
	// So solvency = totalLiquidity / (totalLiquidity * util / BPS)
	//             = BPS / util (if util > 0)

	let solvencyRatio = 0;
	let maxExpectedClaim = 0n;

	if (poolHealth.utilizationRatio > 0n) {
		maxExpectedClaim =
			(poolHealth.totalLiquidity * poolHealth.utilizationRatio) / BigInt(BPS);
		solvencyRatio =
			Number(poolHealth.totalLiquidity) / Number(maxExpectedClaim);
	} else if (poolHealth.totalLiquidity > 0n) {
		// No claims yet → infinite solvency
		solvencyRatio = Number.POSITIVE_INFINITY;
	}

	// ── 5. Determine verification status ────────────────────────────
	let status: VerificationStatus = "HEALTHY";

	if (solvencyRatio < SOLVENCY_CRITICAL_THRESHOLD && solvencyRatio > 0) {
		status = "CRITICAL";
	} else if (solvencyRatio < SOLVENCY_WARNING_THRESHOLD && solvencyRatio > 0) {
		status = "WARNING";
	}

	// ── 6. Generate verification report ─────────────────────────────
	runtime.log("--- RESERVE VERIFICATION REPORT ---");
	runtime.log(`Protocol: ${config.monitoredProtocol}`);
	runtime.log(`Protocol TVL: $${(protocolTvl / 1e9).toFixed(2)}B`);
	runtime.log(
		`Pool Liquidity: $${(Number(poolHealth.totalLiquidity) / 1e6).toFixed(2)} USDC`,
	);
	runtime.log(
		`Pool Utilization: ${Number(poolHealth.utilizationRatio)} bps (${(Number(poolHealth.utilizationRatio) / 100).toFixed(1)}%)`,
	);
	runtime.log(
		`Max Expected Claim: $${(Number(maxExpectedClaim) / 1e6).toFixed(2)} USDC`,
	);

	if (solvencyRatio === Number.POSITIVE_INFINITY) {
		runtime.log("Pool Solvency: INFINITE (no claims yet)");
	} else if (solvencyRatio > 0) {
		runtime.log(`Pool Solvency: ${solvencyRatio.toFixed(2)}x`);
	} else {
		runtime.log("Pool Solvency: N/A (no liquidity)");
	}

	runtime.log(`Status: ${status}`);
	runtime.log(`Pool Paused: ${poolHealth.isPaused ? "YES" : "NO"}`);
	runtime.log("--- END REPORT ---");

	// ── 7. Take action based on solvency ────────────────────────────
	if (
		status === "WARNING" &&
		solvencyRatio < SOLVENCY_WARNING_THRESHOLD &&
		solvencyRatio > 0
	) {
		runtime.log(
			`WARNING: Pool solvency (${solvencyRatio.toFixed(2)}x) below warning threshold (${SOLVENCY_WARNING_THRESHOLD}x). Monitor closely.`,
		);
	}

	if (
		status === "CRITICAL" &&
		solvencyRatio < SOLVENCY_CRITICAL_THRESHOLD &&
		solvencyRatio > 0 &&
		!poolHealth.isPaused
	) {
		runtime.log(
			`CRITICAL: Pool solvency (${solvencyRatio.toFixed(2)}x) below critical threshold (${SOLVENCY_CRITICAL_THRESHOLD}x). Pausing new shields.`,
		);

		// Pause new shield activations
		const gasLimit = config.gasLimit ?? "500000";
		const pauseData = encodeFunctionData({
			abi: INSURANCE_POOL_ABI,
			functionName: "pauseNewShields",
		});

		try {
			const report = runtime
				.report(prepareReportRequest(pauseData))
				.result();

			const resp = evmClient
				.writeReport(runtime, {
					receiver: config.insurancePoolAddress,
					report,
					gasConfig: { gasLimit: BigInt(gasLimit) },
				})
				.result();

			if (resp.txStatus !== TxStatus.SUCCESS) {
				runtime.log(
					`pauseNewShields failed: ${resp.errorMessage ?? `status=${resp.txStatus}`}`,
				);
			} else {
				runtime.log("pauseNewShields executed successfully");
			}
		} catch (err) {
			runtime.log(`pauseNewShields error: ${String(err)}`);
		}
	}

	runtime.log(`[RESERVE_VERIFIER] Verification complete. Status: ${status}`);

	return {
		status,
		protocolTvl,
		poolLiquidity: Number(poolHealth.totalLiquidity),
		utilizationBps: Number(poolHealth.utilizationRatio),
		solvencyRatio:
			solvencyRatio === Number.POSITIVE_INFINITY ? -1 : solvencyRatio,
		isPaused: poolHealth.isPaused,
	};
};

// ── Workflow Wiring ─────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
	const cron = new CronCapability();
	return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
