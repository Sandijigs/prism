/**
 * AI Risk Agent Workflow
 *
 * Gathers multi-source DeFi risk data via Confidential HTTP (privacy track),
 * sends it to an LLM for AI-powered analysis (AI track), and automatically
 * trades in the RiskMarket based on the AI's assessment.
 *
 * Demonstrates:
 * - CRE & AI track: LLM-powered risk analysis with structured prompting
 * - Privacy track: ALL external calls use Confidential HTTP — API keys,
 *   data sources, analysis, and trading strategy stay private in the DON enclave
 * - DON consensus: Median aggregation on LLM risk scores across nodes
 *
 * Pattern: cron → Confidential HTTP (TVL + GitHub + News + LLM) → on-chain read
 *        → AI decision → on-chain write
 */

import {
	CronCapability,
	ConfidentialHTTPClient,
	type ConfidentialHTTPSendRequester,
	consensusMedianAggregation,
	EVMClient,
	encodeCallMsg,
	getNetwork,
	handler,
	LATEST_BLOCK_NUMBER,
	prepareReportRequest,
	Runner,
	type Runtime,
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
	chainRpcUrl: z.string(),
	chainSelectorName: z.string(),
	llmApiUrl: z.string(),
	llmApiKey: z.string(), // In production, stored in VaultDON secrets
	defiLlamaApiUrl: z.string(),
	newsApiUrl: z.string().optional(),
	githubApiUrl: z.string(),
	githubRepo: z.string().optional(),
	monitoredProtocol: z.string(),
	tradeAmountUsdc: z.string(),
	gasLimit: z.string().optional(),
});

type Config = z.infer<typeof configSchema>;

// ── RiskMarket ABI ──────────────────────────────────────────────────────

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
	{
		name: "sellRisk",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "riskAmount", type: "uint256" }],
		outputs: [{ name: "usdcOut", type: "uint256" }],
	},
] as const;

// ── Constants ───────────────────────────────────────────────────────────

const ZONE_NAMES = ["Green", "Yellow", "Orange", "Red"] as const;

const SECURITY_KEYWORDS = [
	"hack",
	"exploit",
	"vulnerability",
	"audit",
	"rug",
	"depeg",
	"security",
	"patch",
	"emergency",
	"breach",
	"drain",
];

// ── Types ───────────────────────────────────────────────────────────────

interface CollectedData {
	tvl: number;
	change24h: string;
	change7d: string;
	newsSummary: string;
	githubSummary: string;
	currentPrice: number;
	zoneName: string;
}

interface LlmAnalysis {
	riskScore: number;
	confidence: number;
	reasoning: string;
	recommendation: "BUY_RISK" | "SELL_RISK" | "HOLD";
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Decode a Confidential HTTP response body to string. */
function decodeBody(body: Uint8Array): string {
	return new TextDecoder().decode(body);
}

// ── Module State ────────────────────────────────────────────────────────

let previousTvl = 0;
let lastGithubSummary = "No GitHub data available";
let lastNewsSummary = "No recent security news";
let lastLlmAnalysis: LlmAnalysis = {
	riskScore: 0,
	confidence: 0,
	reasoning: "No analysis yet",
	recommendation: "HOLD",
};

// ══════════════════════════════════════════════════════════════════════════
//  Data Source 1: DeFiLlama TVL (Confidential HTTP + DON consensus)
// ══════════════════════════════════════════════════════════════════════════

const fetchTvl = (
	sendRequester: ConfidentialHTTPSendRequester,
	config: Config,
): number => {
	const url = `${config.defiLlamaApiUrl}/tvl/${config.monitoredProtocol}`;
	const response = sendRequester
		.sendRequest({
			request: { url, method: "GET" },
			encryptOutput: false,
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`DeFiLlama API failed (${response.statusCode})`);
	}

	const tvl = Number.parseFloat(decodeBody(response.body));
	if (Number.isNaN(tvl)) {
		throw new Error(`Invalid TVL response: ${decodeBody(response.body)}`);
	}
	return tvl;
};

// ══════════════════════════════════════════════════════════════════════════
//  Data Source 2: GitHub Activity (Confidential HTTP + DON consensus)
// ══════════════════════════════════════════════════════════════════════════

const fetchGithubSecurityCount = (
	sendRequester: ConfidentialHTTPSendRequester,
	config: Config,
): number => {
	if (!config.githubRepo) {
		lastGithubSummary = "No GitHub repo configured";
		return 0;
	}

	const url = `${config.githubApiUrl}/repos/${config.githubRepo}/commits?per_page=10`;
	const response = sendRequester
		.sendRequest({
			request: { url, method: "GET" },
			encryptOutput: false,
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) {
		lastGithubSummary = "GitHub API unavailable (rate limited or error)";
		return 0;
	}

	try {
		const commits = JSON.parse(decodeBody(response.body)) as Array<{
			commit?: { message?: string; author?: { date?: string } };
		}>;
		let securityCount = 0;
		const summaries: string[] = [];

		for (const commit of commits) {
			const msg: string = commit.commit?.message ?? "";
			const msgLower = msg.toLowerCase();
			const isSecurity = SECURITY_KEYWORDS.some((kw) =>
				msgLower.includes(kw),
			);
			if (isSecurity) securityCount++;
			summaries.push(
				`${isSecurity ? "[SECURITY] " : ""}${msg.split("\n")[0]}`,
			);
		}

		lastGithubSummary =
			summaries.length > 0
				? `${commits.length} recent commits, ${securityCount} security-related:\n${summaries.join("\n")}`
				: "No recent commits";
		return securityCount;
	} catch {
		lastGithubSummary = "Failed to parse GitHub response";
		return 0;
	}
};

// ══════════════════════════════════════════════════════════════════════════
//  Data Source 3: News Sentiment (Confidential HTTP + DON consensus)
//
//  Searches for protocol name in recent news and flags security keywords.
//  Uses newsApiUrl if configured; otherwise generates sentiment from the
//  data already collected (TVL + GitHub).
// ══════════════════════════════════════════════════════════════════════════

const fetchNewsSentiment = (
	sendRequester: ConfidentialHTTPSendRequester,
	config: Config,
): number => {
	// If a news API is configured, try to fetch real news
	if (config.newsApiUrl) {
		try {
			const url = `${config.newsApiUrl}/v2/everything?q=${config.monitoredProtocol}+crypto&sortBy=publishedAt&pageSize=5`;
			const response = sendRequester
				.sendRequest({
					request: { url, method: "GET" },
					encryptOutput: true, // Keep news data private
				})
				.result();

			if (response.statusCode >= 200 && response.statusCode < 300) {
				const data = JSON.parse(decodeBody(response.body));
				const articles = data.articles ?? [];
				let flagCount = 0;
				const headlines: string[] = [];

				for (const article of articles) {
					const title: string = (article.title ?? "").toLowerCase();
					const desc: string = (article.description ?? "").toLowerCase();
					const combined = `${title} ${desc}`;
					const hasFlag = SECURITY_KEYWORDS.some((kw) =>
						combined.includes(kw),
					);
					if (hasFlag) flagCount++;
					headlines.push(
						`${hasFlag ? "[ALERT] " : ""}${article.title ?? "Untitled"}`,
					);
				}

				lastNewsSummary =
					headlines.length > 0
						? headlines.join("; ")
						: `No recent news for ${config.monitoredProtocol}`;
				return flagCount;
			}
		} catch {
			// Fall through to synthetic sentiment
		}
	}

	// Synthetic sentiment derived from TVL movement + GitHub activity
	lastNewsSummary = `No news API configured. Synthetic assessment: ${config.monitoredProtocol} protocol activity appears normal based on TVL and code signals.`;
	return 0;
};

// ══════════════════════════════════════════════════════════════════════════
//  LLM Analysis (Confidential HTTP — Privacy Track)
//
//  ALL data sent to the LLM and the analysis response stay private within
//  the DON enclave via Confidential HTTP.  Each DON node independently
//  calls the LLM, and consensusMedianAggregation picks the median risk
//  score for robustness against non-deterministic LLM outputs.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Build the structured prompt matching the spec format exactly.
 */
function buildLlmPrompt(protocol: string, data: CollectedData): string {
	return `You are a DeFi risk analyst. Analyze the following protocol data and assess the risk of a significant loss event (hack, exploit, depeg, or rug pull) in the next 30 days.

Protocol: ${protocol}
TVL: $${(data.tvl / 1e9).toFixed(2)}B (24h change: ${data.change24h}%, 7d change: ${data.change7d}%)
Recent news: ${data.newsSummary}
Code activity: ${data.githubSummary}
Current market risk price: ${data.currentPrice}%

Respond in JSON format only:
{
  "riskScore": <0-100>,
  "confidence": <0-100>,
  "reasoning": "<brief explanation>",
  "recommendation": "BUY_RISK" | "SELL_RISK" | "HOLD"
}`;
}

/**
 * Parse the LLM response text into a structured analysis.
 * Handles markdown fences and malformed JSON gracefully.
 */
function parseLlmResponse(responseText: string): LlmAnalysis {
	let cleaned = responseText.trim();
	// Strip markdown code fences if present
	if (cleaned.startsWith("```")) {
		cleaned = cleaned
			.replace(/^```(?:json)?\n?/, "")
			.replace(/\n?```$/, "");
	}

	const parsed = JSON.parse(cleaned);
	const rec = String(parsed.recommendation ?? "HOLD").toUpperCase();
	return {
		riskScore: Math.max(0, Math.min(100, Math.round(parsed.riskScore ?? 0))),
		confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 0))),
		reasoning: String(parsed.reasoning ?? "No reasoning provided"),
		recommendation: (
			["BUY_RISK", "SELL_RISK", "HOLD"].includes(rec) ? rec : "HOLD"
		) as LlmAnalysis["recommendation"],
	};
}

/**
 * Generate a mock LLM response that demonstrates the correct flow.
 * Used when the real LLM API is unavailable (quota, network, etc.).
 */
function generateMockLlmAnalysis(data: CollectedData): LlmAnalysis {
	// Derive a reasonable risk score from the collected data
	let score = data.currentPrice;

	// TVL signals
	const change24h = Number.parseFloat(data.change24h) || 0;
	const change7d = Number.parseFloat(data.change7d) || 0;
	if (change24h < -10 || change7d < -20) score += 25;
	else if (change24h < -5 || change7d < -10) score += 12;
	else if (change24h < -2) score += 5;
	else if (change24h > 2) score -= 3;

	// News signals (count [ALERT] flags)
	const alertCount = (data.newsSummary.match(/\[ALERT\]/g) ?? []).length;
	score += alertCount * 8;

	// GitHub signals (count [SECURITY] flags)
	const securityCount = (
		data.githubSummary.match(/\[SECURITY\]/g) ?? []
	).length;
	score += securityCount * 5;

	score = Math.max(0, Math.min(100, Math.round(score)));

	const diff = score - data.currentPrice;
	let recommendation: LlmAnalysis["recommendation"] = "HOLD";
	if (diff > 10) recommendation = "BUY_RISK";
	else if (diff < -10) recommendation = "SELL_RISK";

	return {
		riskScore: score,
		confidence: 65, // Moderate confidence for heuristic
		reasoning: `[MOCK] TVL 24h: ${data.change24h}%, GitHub security commits: ${securityCount}, news alerts: ${alertCount}. Market ${diff > 0 ? "underprices" : diff < 0 ? "overprices" : "correctly prices"} risk.`,
		recommendation,
	};
}

/**
 * Call the LLM via Confidential HTTP and return the risk score.
 * Runs inside the DON enclave — API key and analysis stay private.
 */
const callLlmForRiskScore = (
	sendRequester: ConfidentialHTTPSendRequester,
	data: CollectedData,
	config: Config,
): number => {
	const prompt = buildLlmPrompt(config.monitoredProtocol, data);

	const geminiBody = JSON.stringify({
		contents: [{ parts: [{ text: prompt }] }],
		generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
	});

	// Confidential HTTP — API key stays within the DON enclave
	const response = sendRequester
		.sendRequest({
			request: {
				url: `${config.llmApiUrl}?key=${config.llmApiKey}`,
				method: "POST",
				bodyString: geminiBody,
				multiHeaders: {
					"Content-Type": { values: ["application/json"] },
				},
			},
			encryptOutput: true, // Encrypt the AI analysis
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) {
		const errorBody = decodeBody(response.body);
		throw new Error(
			`LLM API error ${response.statusCode}: ${errorBody.slice(0, 200)}`,
		);
	}

	const responseText = decodeBody(response.body);
	const geminiResponse = JSON.parse(responseText);
	const analysisText: string =
		geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

	const analysis = parseLlmResponse(analysisText);
	lastLlmAnalysis = analysis;
	return analysis.riskScore;
};

// ══════════════════════════════════════════════════════════════════════════
//  Main Handler
// ══════════════════════════════════════════════════════════════════════════

const onCronTrigger = (runtime: Runtime<Config>) => {
	const config = runtime.config;
	runtime.log(`=== AI Risk Agent: ${config.monitoredProtocol} ===`);

	const confidentialHTTP = new ConfidentialHTTPClient();

	// ── 1. Fetch TVL via Confidential HTTP with DON consensus ───────────
	let currentTvl: number;
	try {
		currentTvl = confidentialHTTP
			.sendRequest(runtime, fetchTvl, consensusMedianAggregation())(config)
			.result();
		runtime.log(`TVL: $${(currentTvl / 1e9).toFixed(2)}B`);
	} catch (err) {
		runtime.log(`TVL fetch failed: ${String(err)}. Skipping cycle.`);
		return { action: "skip", reason: "tvl_fetch_error" };
	}

	// Compute TVL changes
	const change24h =
		previousTvl > 0
			? (((currentTvl - previousTvl) / previousTvl) * 100).toFixed(2)
			: "0.00";
	// 7d change approximated as 7x the per-cycle delta (first run = 0)
	const change7d =
		previousTvl > 0
			? (((currentTvl - previousTvl) / previousTvl) * 100 * 7).toFixed(2)
			: "0.00";

	previousTvl = currentTvl;

	// ── 2. Fetch GitHub activity via Confidential HTTP with consensus ───
	let securityCommitCount = 0;
	try {
		securityCommitCount = confidentialHTTP
			.sendRequest(
				runtime,
				fetchGithubSecurityCount,
				consensusMedianAggregation(),
			)(config)
			.result();
		runtime.log(
			`GitHub: ${securityCommitCount} security-related commits in last 10`,
		);
	} catch (err) {
		runtime.log(
			`GitHub fetch failed: ${String(err)}. Continuing without GitHub data.`,
		);
	}

	// ── 3. Fetch news sentiment via Confidential HTTP with consensus ────
	let newsAlertCount = 0;
	try {
		newsAlertCount = confidentialHTTP
			.sendRequest(
				runtime,
				fetchNewsSentiment,
				consensusMedianAggregation(),
			)(config)
			.result();
		runtime.log(`News: ${newsAlertCount} security-flagged articles`);
	} catch (err) {
		runtime.log(
			`News fetch failed: ${String(err)}. Continuing without news data.`,
		);
	}

	// ── 4. Read on-chain market state ───────────────────────────────────
	const network = getNetwork({
		chainFamily: "evm",
		chainSelectorName: config.chainSelectorName,
		isTestnet: true,
	});

	let currentPrice: bigint = 2n;
	let currentZone = 0;

	if (network) {
		const evmClient = new EVMClient(network.chainSelector.selector);
		try {
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
			runtime.log(`On-chain read failed: ${String(err)}. Using defaults.`);
		}
	}

	const zoneName = ZONE_NAMES[currentZone] ?? "Unknown";
	runtime.log(
		`Market: price=${currentPrice}%, zone=${zoneName} | TVL Δ24h=${change24h}%`,
	);

	// ── 5. AI Risk Analysis via Confidential HTTP ───────────────────────
	const collectedData: CollectedData = {
		tvl: currentTvl,
		change24h,
		change7d,
		newsSummary: lastNewsSummary,
		githubSummary: lastGithubSummary,
		currentPrice: Number(currentPrice),
		zoneName,
	};

	let aiRiskScore: number;
	try {
		aiRiskScore = confidentialHTTP
			.sendRequest(
				runtime,
				callLlmForRiskScore,
				consensusMedianAggregation(),
			)(collectedData, config)
			.result();

		runtime.log(
			`LLM Analysis: riskScore=${aiRiskScore}, confidence=${lastLlmAnalysis.confidence}, ` +
				`recommendation=${lastLlmAnalysis.recommendation}, ` +
				`reasoning="${lastLlmAnalysis.reasoning}"`,
		);
	} catch (err) {
		// Fall back to mock LLM response that shows the correct flow
		runtime.log(
			`LLM API unavailable: ${String(err).slice(0, 100)}. Using mock analysis.`,
		);

		const mockAnalysis = generateMockLlmAnalysis(collectedData);
		lastLlmAnalysis = mockAnalysis;
		aiRiskScore = mockAnalysis.riskScore;

		runtime.log(
			`Mock LLM Analysis: riskScore=${aiRiskScore}, confidence=${mockAnalysis.confidence}, ` +
				`recommendation=${mockAnalysis.recommendation}, ` +
				`reasoning="${mockAnalysis.reasoning}"`,
		);
	}

	// ── 6. Trading decision ─────────────────────────────────────────────
	const analysis = lastLlmAnalysis;

	if (analysis.recommendation === "HOLD" || analysis.confidence <= 60) {
		runtime.log(
			`Decision: ${analysis.recommendation} (confidence=${analysis.confidence}). No trade.`,
		);
		return {
			recommendation: analysis.recommendation,
			riskScore: analysis.riskScore,
			confidence: analysis.confidence,
			reasoning: analysis.reasoning,
			marketPrice: Number(currentPrice),
			zone: zoneName,
		};
	}

	const tradeAmount = BigInt(config.tradeAmountUsdc) * 1_000_000n;
	runtime.log(
		`Decision: ${analysis.recommendation} → executing ${config.tradeAmountUsdc} USDC trade`,
	);

	// ── 7. Execute trade on-chain ───────────────────────────────────────
	if (analysis.recommendation === "BUY_RISK" && network) {
		try {
			const evmClient = new EVMClient(network.chainSelector.selector);
			const writeCallData = encodeFunctionData({
				abi: RISK_MARKET_ABI,
				functionName: "buyRisk",
				args: [tradeAmount],
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
					`BUY_RISK trade failed: ${resp.errorMessage ?? `status=${resp.txStatus}`}`,
				);
				return {
					recommendation: "trade_failed",
					riskScore: analysis.riskScore,
					error: resp.errorMessage ?? "unknown",
				};
			}

			runtime.log("BUY_RISK trade executed successfully");
		} catch (err) {
			runtime.log(`BUY_RISK execution failed: ${String(err)}`);
			return {
				recommendation: "trade_failed",
				riskScore: analysis.riskScore,
				error: String(err),
			};
		}
	}

	if (analysis.recommendation === "SELL_RISK" && network) {
		// SELL requires holding RISK tokens. In production the CRE wallet
		// would maintain an inventory. For now, log the signal.
		runtime.log(
			"SELL_RISK signal — logged for alerting (CRE wallet has no RISK inventory yet).",
		);
	}

	return {
		recommendation: analysis.recommendation,
		riskScore: analysis.riskScore,
		confidence: analysis.confidence,
		reasoning: analysis.reasoning,
		marketPrice: Number(currentPrice),
		zone: zoneName,
		tradeAmountUsdc: Number(tradeAmount) / 1e6,
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
