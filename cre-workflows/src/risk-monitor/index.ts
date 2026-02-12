/**
 * Risk Monitor Workflow
 *
 * Periodically fetches protocol TVL data from DeFiLlama, computes a composite
 * risk score, and nudges the RiskMarket on-chain price when reality diverges
 * from market sentiment.
 *
 * Pattern: cron trigger → HTTP fetch (with consensus) → on-chain read → compute → on-chain write
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
	chainSelectorName: z.string(),
	defiLlamaApiUrl: z.string(),
	monitoredProtocol: z.string(),
	gasLimit: z.string().optional(),
});

type Config = z.infer<typeof configSchema>;

// ── RiskMarket ABI (only the functions we need) ─────────────────────────

const RISK_MARKET_ABI = [
	{
		name: "getCurrentRiskPrice",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "price", type: "uint256" }],
	},
	{
		name: "getCurrentZone",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint8" }],
	},
	{
		name: "buyRisk",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "usdcAmount", type: "uint256" }],
		outputs: [{ name: "tokensOut", type: "uint256" }],
	},
] as const;

// ── Constants ───────────────────────────────────────────────────────────

const ZONE_NAMES = ["Green", "Yellow", "Orange", "Red"] as const;

// Act when risk score differs from market by this many points
const SCORE_DIVERGENCE_THRESHOLD = 10;

// TVL change → risk points mapping
const TVL_DROP_SEVERE = 10; // >10% drop
const TVL_DROP_MODERATE = 5; // >5% drop
const TVL_DROP_MINOR = 2; // >2% drop

const RISK_POINTS_SEVERE = 30;
const RISK_POINTS_MODERATE = 15;
const RISK_POINTS_MINOR = 5;
const RISK_POINTS_INCREASE = -5;

// Track previous TVL across invocations (in-memory for simulation)
let previousTvl = 0;

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

// ── Risk Score Computation ──────────────────────────────────────────────

function computeRiskScore(
	currentTvl: number,
	prevTvl: number,
	currentMarketPrice: number,
): number {
	// Start from the current market price as baseline
	let score = currentMarketPrice;

	if (prevTvl > 0) {
		const changePercent = ((currentTvl - prevTvl) / prevTvl) * 100;

		if (changePercent <= -TVL_DROP_SEVERE) {
			score += RISK_POINTS_SEVERE;
		} else if (changePercent <= -TVL_DROP_MODERATE) {
			score += RISK_POINTS_MODERATE;
		} else if (changePercent <= -TVL_DROP_MINOR) {
			score += RISK_POINTS_MINOR;
		} else if (changePercent > 0) {
			score += RISK_POINTS_INCREASE;
		}
	}

	// Clamp to 0–99
	return Math.max(0, Math.min(99, Math.round(score)));
}

// ── Main Handler ────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>) => {
	const config = runtime.config;

	runtime.log(`=== Risk Monitor: ${config.monitoredProtocol} ===`);

	// ── 1. Fetch TVL via HTTP with DON consensus ────────────────────────
	let currentTvl: number;
	try {
		const httpClient = new HTTPClient();
		currentTvl = httpClient
			.sendRequest(runtime, fetchProtocolTvl, consensusMedianAggregation())(
				config,
			)
			.result();
		runtime.log(`TVL fetched: $${(currentTvl / 1e9).toFixed(2)}B`);
	} catch (err) {
		runtime.log(`HTTP fetch failed: ${String(err)}. Skipping cycle.`);
		return { action: "skip", reason: "api_error" };
	}

	// ── 2. Read current market state from RiskMarket ────────────────────
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

	let currentPrice: bigint = 2n; // default: initial market price
	let currentZone: number = 0; // default: Green

	try {
		// Read current risk price
		const priceCallData = encodeFunctionData({
			abi: RISK_MARKET_ABI,
			functionName: "getCurrentRiskPrice",
		});

		const priceResult = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: config.riskMarketAddress as Address,
					data: priceCallData,
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result();

		currentPrice = decodeFunctionResult({
			abi: RISK_MARKET_ABI,
			functionName: "getCurrentRiskPrice",
			data: bytesToHex(priceResult.data),
		});

		// Read current zone
		const zoneCallData = encodeFunctionData({
			abi: RISK_MARKET_ABI,
			functionName: "getCurrentZone",
		});

		const zoneResult = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: config.riskMarketAddress as Address,
					data: zoneCallData,
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result();

		currentZone = Number(
			decodeFunctionResult({
				abi: RISK_MARKET_ABI,
				functionName: "getCurrentZone",
				data: bytesToHex(zoneResult.data),
			}),
		);
	} catch (err) {
		runtime.log(
			`On-chain read failed (contract may not exist on simulation chain): ${String(err)}`,
		);
		runtime.log("Using default market state: price=2%, zone=Green");
	}

	const zoneName = ZONE_NAMES[currentZone] ?? "Unknown";
	runtime.log(`Market state: price=${currentPrice}%, zone=${zoneName}`);

	// ── 3. Compute composite risk score ─────────────────────────────────
	const riskScore = computeRiskScore(
		currentTvl,
		previousTvl,
		Number(currentPrice),
	);

	const tvlChange =
		previousTvl > 0
			? (((currentTvl - previousTvl) / previousTvl) * 100).toFixed(2)
			: "N/A (first run)";

	runtime.log(
		`Risk score: ${riskScore} | TVL change: ${tvlChange}% | Market price: ${currentPrice}%`,
	);

	// Update previous TVL for next cycle
	previousTvl = currentTvl;

	// ── 4. Decide action ────────────────────────────────────────────────
	const priceDiff = riskScore - Number(currentPrice);
	const absDiff = Math.abs(priceDiff);

	if (absDiff < SCORE_DIVERGENCE_THRESHOLD) {
		runtime.log(
			`Score-price divergence (${absDiff}) below threshold (${SCORE_DIVERGENCE_THRESHOLD}). No action.`,
		);
		return {
			action: "none" as const,
			riskScore,
			currentPrice: Number(currentPrice),
			tvlChangePercent: tvlChange,
			zone: zoneName,
		};
	}

	// Risk score higher than market → buy RISK (push price up)
	const action = priceDiff > 0 ? ("buy" as const) : ("sell" as const);

	// Trade size: 100 USDC per point of divergence (simplified for hackathon)
	const tradeUsdcAmount = BigInt(absDiff) * 100n * 1_000_000n; // 6 decimals

	runtime.log(
		`Action: ${action} ${Number(tradeUsdcAmount) / 1e6} USDC (divergence=${priceDiff})`,
	);

	// ── 5. Execute trade via on-chain write ──────────────────────────────
	if (action === "buy") {
		const writeCallData = encodeFunctionData({
			abi: RISK_MARKET_ABI,
			functionName: "buyRisk",
			args: [tradeUsdcAmount],
		});

		const report = runtime
			.report(prepareReportRequest(writeCallData))
			.result();

		const resp = evmClient
			.writeReport(runtime, {
				receiver: config.riskMarketAddress,
				report,
				gasConfig: { gasLimit: BigInt(config.gasLimit ?? "500000") },
			})
			.result();

		if (resp.txStatus !== TxStatus.SUCCESS) {
			runtime.log(
				`Trade failed: ${resp.errorMessage ?? `status=${resp.txStatus}`}`,
			);
			return {
				action: "trade_failed" as const,
				riskScore,
				error: resp.errorMessage ?? "unknown",
			};
		}

		runtime.log("Buy trade executed successfully");
	}

	// Sell requires holding RISK tokens — for the hackathon the CRE
	// workflow primarily pushes price up when external risk increases.
	if (action === "sell") {
		runtime.log(
			"Sell signal detected but not executed (no RISK inventory). Logged for alerting.",
		);
	}

	return {
		action,
		riskScore,
		currentPrice: Number(currentPrice),
		tvlChangePercent: tvlChange,
		zone: zoneName,
		tradeAmount: Number(tradeUsdcAmount) / 1e6,
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
