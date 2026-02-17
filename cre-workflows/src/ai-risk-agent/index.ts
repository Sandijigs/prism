/**
 * AI Risk Agent Workflow (Enhanced — Production Quality)
 *
 * Multi-source risk aggregation with AI-powered analysis via Confidential HTTP.
 * Gathers data from 4 independent sources, feeds to an LLM for analysis,
 * falls back to rule-based scoring, and executes trades with hysteresis.
 *
 * Data Sources (all via Confidential HTTP with DON consensus):
 *   1. DeFiLlama — protocol TVL + historical
 *   2. DeFiLlama — stablecoin total market cap (systemic health)
 *   3. GitHub — commit_activity (development velocity)
 *   4. CoinGecko — global market cap change (sentiment proxy)
 *
 * Trading Logic:
 *   - Hysteresis: only trades when score changes >= 5 points from last trade
 *   - Cooldown: minimum 2 minutes between trades
 *   - Confidence tiers: <30 HOLD, 30-50 reduced (25%), >50 full size
 *   - Base trade 1000 USDC, scaled by |riskScore - currentPrice| / 50
 *   - Clamped to [100, 5000] USDC
 *
 * Pattern: cron → Confidential HTTP (4 sources + LLM) → on-chain read
 *        → AI decision → hysteresis gate → on-chain write
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
import {
	trackConfidentialRequest,
	logPrivacyStatus,
	resetPrivacyReport,
} from "../shared/confidential-http";
import { privateTransact } from "../shared/private-tx";

// ── Config ──────────────────────────────────────────────────────────────

const configSchema = z.object({
	schedule: z.string(),
	riskMarketAddress: z.string(),
	chainRpcUrl: z.string(),
	chainSelectorName: z.string(),
	llmApiUrl: z.string(),
	llmApiKey: z.string(),
	defiLlamaApiUrl: z.string(),
	githubApiUrl: z.string(),
	githubRepo: z.string().optional(),
	monitoredProtocol: z.string(),
	tradeAmountUsdc: z.string(),
	gasLimit: z.string().optional(),
	coinGeckoApiUrl: z.string().optional(),
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
const STABLECOINS_API =
	"https://stablecoins.llama.fi/stablecoins?includePrices=true";
const COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global";

const HYSTERESIS_THRESHOLD = 5;
const COOLDOWN_MS = 120_000; // 2 minutes
const BASE_TRADE_USDC = 1000;
const MIN_TRADE_USDC = 100;
const MAX_TRADE_USDC = 5_000;

// ── Exported Types ──────────────────────────────────────────────────────

export interface AggregatedData {
	timestamp: number;
	tvl: {
		current: number;
		change24h: number;
		change7d: number;
		trend: "up" | "down" | "stable";
	};
	stablecoins: { totalMcap: number; change24h: number } | null;
	github: {
		weeklyCommits: number;
		avgCommits: number;
		dropPercent: number;
	} | null;
	sentiment: { marketCapChange24h: number } | null;
	sourcesAvailable: number;
	sourcesTotal: number;
}

export interface LLMAnalysis {
	riskScore: number;
	confidence: number;
	recommendation: "BUY_RISK" | "SELL_RISK" | "HOLD";
	reasoning: string;
	signals: string[];
}

export interface AgentDecision {
	timestamp: number;
	cycleId: string;
	dataSnapshot: AggregatedData;
	llmAnalysis: LLMAnalysis | null;
	fallbackUsed: boolean;
	finalScore: number;
	finalConfidence: number;
	recommendation: string;
	tradeExecuted: boolean;
	tradeAmount: number | null;
	reasoning: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function decodeBody(body: Uint8Array): string {
	return new TextDecoder().decode(body);
}

// ── Module State ────────────────────────────────────────────────────────

const tvlHistory: Array<{ ts: number; value: number }> = [];
let previousStablecoinMcap = 0;
let storedGithubAvg = 0;
let lastTradeScore = -1;
let lastTradeTimestamp = 0;
let cycleCounter = 0;
let lastLlmAnalysis: LLMAnalysis = {
	riskScore: 0,
	confidence: 0,
	reasoning: "No analysis yet",
	recommendation: "HOLD",
	signals: [],
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
		throw new Error(`DeFiLlama TVL API failed (${response.statusCode})`);
	}

	const tvl = Number.parseFloat(decodeBody(response.body));
	if (Number.isNaN(tvl)) throw new Error("Invalid TVL response");
	return tvl;
};

// ══════════════════════════════════════════════════════════════════════════
//  Data Source 2: DeFiLlama Stablecoins (systemic health indicator)
// ══════════════════════════════════════════════════════════════════════════

const fetchStablecoinMcap = (
	sendRequester: ConfidentialHTTPSendRequester,
	_config: Config,
): number => {
	const response = sendRequester
		.sendRequest({
			request: { url: STABLECOINS_API, method: "GET" },
			encryptOutput: false,
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`Stablecoins API failed (${response.statusCode})`);
	}

	const data = JSON.parse(decodeBody(response.body));
	const assets = data.peggedAssets ?? [];
	let totalMcap = 0;
	for (const asset of assets) {
		totalMcap += asset.circulating?.peggedUSD ?? 0;
	}
	return totalMcap;
};

// ══════════════════════════════════════════════════════════════════════════
//  Data Source 3: GitHub commit_activity (development velocity)
//  Returns most recent week's commit count. Also computes 4-week average
//  and stores it in module state for dropPercent calculation.
// ══════════════════════════════════════════════════════════════════════════

const fetchWeeklyCommits = (
	sendRequester: ConfidentialHTTPSendRequester,
	config: Config,
): number => {
	if (!config.githubRepo) return 0;

	const url = `${config.githubApiUrl}/repos/${config.githubRepo}/stats/commit_activity`;
	const response = sendRequester
		.sendRequest({
			request: { url, method: "GET" },
			encryptOutput: false,
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) return 0;

	try {
		const weeks = JSON.parse(decodeBody(response.body)) as Array<{
			total: number;
			week: number;
		}>;
		if (weeks.length === 0) return 0;

		// Current week = last entry
		const recentWeek = weeks[weeks.length - 1].total;

		// 4-week average (excluding current week)
		const prevWeeks = weeks.slice(-5, -1);
		if (prevWeeks.length > 0) {
			storedGithubAvg =
				prevWeeks.reduce((sum, w) => sum + w.total, 0) / prevWeeks.length;
		}

		return recentWeek;
	} catch {
		return 0;
	}
};

// ══════════════════════════════════════════════════════════════════════════
//  Data Source 4: CoinGecko Global Market Sentiment
// ══════════════════════════════════════════════════════════════════════════

const fetchMarketCapChange = (
	sendRequester: ConfidentialHTTPSendRequester,
	config: Config,
): number => {
	const url = config.coinGeckoApiUrl
		? `${config.coinGeckoApiUrl}/global`
		: COINGECKO_GLOBAL;

	const response = sendRequester
		.sendRequest({
			request: { url, method: "GET" },
			encryptOutput: false,
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) return 0;

	try {
		const data = JSON.parse(decodeBody(response.body));
		return data.data?.market_cap_change_percentage_24h_usd ?? 0;
	} catch {
		return 0;
	}
};

// ══════════════════════════════════════════════════════════════════════════
//  fetchAllSources() — Multi-source data aggregation orchestrator
//  Each source has independent error handling (returns null on failure).
// ══════════════════════════════════════════════════════════════════════════

function fetchAllSources(
	runtime: Runtime<Config>,
	confidentialHTTP: ConfidentialHTTPClient,
	config: Config,
): AggregatedData | null {
	const now = Date.now();
	let sourcesAvailable = 0;

	// Source 1: DeFiLlama TVL (required — skip cycle if this fails)
	let currentTvl: number;
	try {
		trackConfidentialRequest(runtime, "DeFiLlama TVL", false);
		currentTvl = confidentialHTTP
			.sendRequest(runtime, fetchTvl, consensusMedianAggregation())(config)
			.result();
		sourcesAvailable++;
		runtime.log(
			`[SRC 1/4] TVL: $${(currentTvl / 1e9).toFixed(2)}B`,
		);
	} catch (err) {
		runtime.log(
			`[SRC 1/4] TVL fetch failed: ${String(err)}. Skipping cycle.`,
		);
		return null;
	}

	// Track TVL history for 24h/7d changes
	tvlHistory.push({ ts: now, value: currentTvl });
	if (tvlHistory.length > 2000) tvlHistory.splice(0, tvlHistory.length - 2000);

	const oneDayAgo = now - 24 * 60 * 60 * 1000;
	const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
	const prev24h = [...tvlHistory].reverse().find((h) => h.ts <= oneDayAgo);
	const prev7d = [...tvlHistory].reverse().find((h) => h.ts <= sevenDaysAgo);

	const change24h = prev24h
		? ((currentTvl - prev24h.value) / prev24h.value) * 100
		: 0;
	const change7d = prev7d
		? ((currentTvl - prev7d.value) / prev7d.value) * 100
		: 0;
	const trend: "up" | "down" | "stable" =
		change24h > 1 ? "up" : change24h < -1 ? "down" : "stable";

	// Source 2: DeFiLlama Stablecoins
	let stablecoins: AggregatedData["stablecoins"] = null;
	try {
		trackConfidentialRequest(runtime, "DeFiLlama Stablecoins", false);
		const mcap = confidentialHTTP
			.sendRequest(
				runtime,
				fetchStablecoinMcap,
				consensusMedianAggregation(),
			)(config)
			.result();

		const stableChange =
			previousStablecoinMcap > 0
				? ((mcap - previousStablecoinMcap) / previousStablecoinMcap) * 100
				: 0;
		previousStablecoinMcap = mcap;

		stablecoins = { totalMcap: mcap, change24h: stableChange };
		sourcesAvailable++;
		runtime.log(
			`[SRC 2/4] Stablecoin MCap: $${(mcap / 1e9).toFixed(0)}B (${stableChange >= 0 ? "+" : ""}${stableChange.toFixed(2)}%)`,
		);
	} catch (err) {
		runtime.log(
			`[SRC 2/4] Stablecoins fetch failed: ${String(err)}. Continuing without.`,
		);
	}

	// Source 3: GitHub commit_activity
	let github: AggregatedData["github"] = null;
	try {
		trackConfidentialRequest(runtime, "GitHub commits", false);
		const weeklyCommits = confidentialHTTP
			.sendRequest(
				runtime,
				fetchWeeklyCommits,
				consensusMedianAggregation(),
			)(config)
			.result();

		const avgCommits = storedGithubAvg;
		const dropPercent =
			avgCommits > 0
				? ((avgCommits - weeklyCommits) / avgCommits) * 100
				: 0;

		github = { weeklyCommits, avgCommits, dropPercent };
		sourcesAvailable++;
		runtime.log(
			`[SRC 3/4] GitHub: ${weeklyCommits} commits this week (avg: ${avgCommits.toFixed(0)}, drop: ${dropPercent.toFixed(0)}%)`,
		);
	} catch (err) {
		runtime.log(
			`[SRC 3/4] GitHub fetch failed: ${String(err)}. Continuing without.`,
		);
	}

	// Source 4: CoinGecko global sentiment
	let sentiment: AggregatedData["sentiment"] = null;
	try {
		trackConfidentialRequest(runtime, "CoinGecko sentiment", false);
		const marketCapChange24h = confidentialHTTP
			.sendRequest(
				runtime,
				fetchMarketCapChange,
				consensusMedianAggregation(),
			)(config)
			.result();

		sentiment = { marketCapChange24h };
		sourcesAvailable++;
		runtime.log(
			`[SRC 4/4] Sentiment: ${marketCapChange24h >= 0 ? "+" : ""}${marketCapChange24h.toFixed(2)}% market cap (24h)`,
		);
	} catch (err) {
		runtime.log(
			`[SRC 4/4] CoinGecko fetch failed: ${String(err)}. Continuing without.`,
		);
	}

	runtime.log(`Data sources available: ${sourcesAvailable}/4`);

	return {
		timestamp: now,
		tvl: { current: currentTvl, change24h, change7d, trend },
		stablecoins,
		github,
		sentiment,
		sourcesAvailable,
		sourcesTotal: 4,
	};
}

// ══════════════════════════════════════════════════════════════════════════
//  LLM Analysis (Confidential HTTP — Privacy Track)
// ══════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(): string {
	return `You are a DeFi risk analyst AI. Analyze the provided protocol data and assess risk level.
You MUST respond with ONLY a JSON object, no markdown, no backticks, no explanation.
JSON format:
{
  "riskScore": <number 0-100>,
  "confidence": <number 0-100>,
  "recommendation": "BUY_RISK" | "SELL_RISK" | "HOLD",
  "reasoning": "<1-2 sentence explanation>",
  "signals": ["<signal1>", "<signal2>"]
}
Risk score meaning: 0=no risk, 50=moderate concern, 100=imminent collapse.
BUY_RISK means the market should price in MORE risk.
SELL_RISK means the market should price in LESS risk.
HOLD means current pricing seems accurate.`;
}

function buildUserPrompt(
	data: AggregatedData,
	currentRiskPrice: number,
	currentZone: string,
): string {
	const ts = new Date(data.timestamp).toISOString();
	const stableStr = data.stablecoins
		? `${data.stablecoins.change24h.toFixed(2)}%`
		: "unavailable";
	const githubStr = data.github
		? `${data.github.weeklyCommits} commits this week vs ${data.github.avgCommits.toFixed(0)} average (${data.github.dropPercent.toFixed(0)}% change)`
		: "unavailable";
	const sentimentStr = data.sentiment
		? `${data.sentiment.marketCapChange24h.toFixed(2)}% market cap change 24h`
		: "unavailable";

	return `Protocol monitoring data as of ${ts}:
- TVL: $${(data.tvl.current / 1e9).toFixed(2)}B (24h: ${data.tvl.change24h.toFixed(2)}%, 7d: ${data.tvl.change7d.toFixed(2)}%, trend: ${data.tvl.trend})
- Stablecoins total mcap 24h change: ${stableStr}
- GitHub: ${githubStr}
- Market sentiment: ${sentimentStr}
- Data sources available: ${data.sourcesAvailable}/${data.sourcesTotal}
Current on-chain risk price: ${currentRiskPrice} basis points (${(currentRiskPrice / 100).toFixed(2)}%)
Current zone: ${currentZone}`;
}

function parseLlmResponse(responseText: string): LLMAnalysis {
	let cleaned = responseText.trim();

	// Strip markdown code fences if present
	if (cleaned.startsWith("```")) {
		cleaned = cleaned
			.replace(/^```(?:json)?\n?/, "")
			.replace(/\n?```$/, "");
	}

	// Try direct JSON parse first
	try {
		const parsed = JSON.parse(cleaned);
		return normalizeLlmResult(parsed);
	} catch {
		// Regex fallback: extract JSON object from response
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			return normalizeLlmResult(parsed);
		}
		throw new Error("Could not extract JSON from LLM response");
	}
}

function normalizeLlmResult(parsed: Record<string, unknown>): LLMAnalysis {
	const rec = String(parsed.recommendation ?? "HOLD").toUpperCase();
	const signals = Array.isArray(parsed.signals)
		? (parsed.signals as string[]).map(String)
		: [];
	return {
		riskScore: Math.max(
			0,
			Math.min(100, Math.round(Number(parsed.riskScore) || 0)),
		),
		confidence: Math.max(
			0,
			Math.min(100, Math.round(Number(parsed.confidence) || 0)),
		),
		reasoning: String(parsed.reasoning ?? "No reasoning provided"),
		recommendation: (
			["BUY_RISK", "SELL_RISK", "HOLD"].includes(rec) ? rec : "HOLD"
		) as LLMAnalysis["recommendation"],
		signals,
	};
}

const callLlmForRiskScore = (
	sendRequester: ConfidentialHTTPSendRequester,
	data: AggregatedData,
	config: Config,
	currentRiskPrice: number,
	currentZone: string,
): number => {
	const systemPrompt = buildSystemPrompt();
	const userPrompt = buildUserPrompt(data, currentRiskPrice, currentZone);

	const geminiBody = JSON.stringify({
		contents: [
			{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
		],
		generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
	});

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
			encryptOutput: true,
		})
		.result();

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`LLM API error ${response.statusCode}`);
	}

	const geminiResponse = JSON.parse(decodeBody(response.body));
	const analysisText: string =
		geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

	const analysis = parseLlmResponse(analysisText);
	lastLlmAnalysis = analysis;
	return analysis.riskScore;
};

/**
 * analyzeWithLLM — Wrapper that calls the LLM via Confidential HTTP.
 * Returns the structured LLMAnalysis or null on failure.
 */
function analyzeWithLLM(
	runtime: Runtime<Config>,
	confidentialHTTP: ConfidentialHTTPClient,
	data: AggregatedData,
	config: Config,
	currentRiskPrice: number,
	currentZone: string,
): LLMAnalysis | null {
	try {
		trackConfidentialRequest(runtime, "LLM Risk Analysis", true);
		const score = confidentialHTTP
			.sendRequest(
				runtime,
				callLlmForRiskScore,
				consensusMedianAggregation(),
			)(data, config, currentRiskPrice, currentZone)
			.result();

		runtime.log(
			`[LLM] score=${score} confidence=${lastLlmAnalysis.confidence} ` +
				`rec=${lastLlmAnalysis.recommendation} signals=[${lastLlmAnalysis.signals.join(", ")}]`,
		);
		runtime.log(`[LLM] reasoning: "${lastLlmAnalysis.reasoning}"`);
		return lastLlmAnalysis;
	} catch (err) {
		runtime.log(
			`[LLM] Unavailable: ${String(err).slice(0, 100)}. Will use rule-based fallback.`,
		);
		return null;
	}
}

// ══════════════════════════════════════════════════════════════════════════
//  calculateFallbackScore — Rule-based scoring when LLM is unavailable
// ══════════════════════════════════════════════════════════════════════════

export function calculateFallbackScore(data: AggregatedData): LLMAnalysis {
	let score = 5; // minimum background risk
	const signals: string[] = [];

	// TVL 24h signals
	if (data.tvl.change24h < -10) {
		score += 40;
		signals.push(`TVL dropped ${data.tvl.change24h.toFixed(1)}% in 24h (>10%)`);
	} else if (data.tvl.change24h < -5) {
		score += 20;
		signals.push(`TVL dropped ${data.tvl.change24h.toFixed(1)}% in 24h (>5%)`);
	} else if (data.tvl.change24h < -2) {
		score += 10;
		signals.push(`TVL dropped ${data.tvl.change24h.toFixed(1)}% in 24h (>2%)`);
	}

	// TVL 7d signals
	if (data.tvl.change7d < -10) {
		score += 15;
		signals.push(`TVL dropped ${data.tvl.change7d.toFixed(1)}% in 7d (>10%)`);
	}

	// GitHub signals
	if (data.github) {
		if (data.github.dropPercent > 50) {
			score += 15;
			signals.push(
				`GitHub commits dropped ${data.github.dropPercent.toFixed(0)}% (>50%)`,
			);
		} else if (data.github.dropPercent > 25) {
			score += 8;
			signals.push(
				`GitHub commits dropped ${data.github.dropPercent.toFixed(0)}% (>25%)`,
			);
		}
	}

	// Stablecoin signals
	if (data.stablecoins && data.stablecoins.change24h < -2) {
		score += 10;
		signals.push(
			`Stablecoin mcap dropped ${data.stablecoins.change24h.toFixed(1)}% (>2%)`,
		);
	}

	// Market sentiment signals
	if (data.sentiment && data.sentiment.marketCapChange24h < -3) {
		score += 10;
		signals.push(
			`Negative market sentiment: ${data.sentiment.marketCapChange24h.toFixed(1)}% (>3% drop)`,
		);
	}

	// Missing sources penalty
	const missingSources = data.sourcesTotal - data.sourcesAvailable;
	if (missingSources > 0) {
		score += missingSources * 5;
		signals.push(`${missingSources} data source(s) unavailable (+${missingSources * 5})`);
	}

	score = Math.max(0, Math.min(100, score));

	// Confidence: 40 (no sources) to 70 (all sources)
	const confidence =
		40 + (data.sourcesAvailable / data.sourcesTotal) * 30;

	const recommendation: LLMAnalysis["recommendation"] =
		score > 60 ? "BUY_RISK" : score < 20 ? "SELL_RISK" : "HOLD";

	return {
		riskScore: score,
		confidence: Math.round(confidence),
		recommendation,
		reasoning: `Rule-based assessment: ${signals.length > 0 ? signals.join(", ") : "no significant signals detected"}`,
		signals,
	};
}

// ══════════════════════════════════════════════════════════════════════════
//  executeTrade — Trading logic with hysteresis and confidence-based sizing
// ══════════════════════════════════════════════════════════════════════════

function executeTrade(
	runtime: Runtime<Config>,
	analysis: LLMAnalysis,
	currentPrice: number,
	network: ReturnType<typeof getNetwork>,
	config: Config,
): { executed: boolean; amount: number | null } {
	// Hysteresis check 1: score within 5 points of current price
	const scoreDiff = Math.abs(analysis.riskScore - currentPrice);
	if (scoreDiff < HYSTERESIS_THRESHOLD) {
		runtime.log(
			`[TRADE] Hysteresis: score-price diff ${scoreDiff} < ${HYSTERESIS_THRESHOLD}. Skipping.`,
		);
		return { executed: false, amount: null };
	}

	// Hysteresis check 2: cooldown
	const now = Date.now();
	if (lastTradeScore >= 0 && now - lastTradeTimestamp < COOLDOWN_MS) {
		runtime.log(
			`[TRADE] Cooldown: ${now - lastTradeTimestamp}ms < ${COOLDOWN_MS}ms. Skipping.`,
		);
		return { executed: false, amount: null };
	}

	// Confidence < 30: not enough data to act
	if (analysis.confidence < 30) {
		runtime.log(
			`[TRADE] Confidence ${analysis.confidence} < 30. Not enough data to trade.`,
		);
		return { executed: false, amount: null };
	}

	if (analysis.recommendation === "HOLD") {
		return { executed: false, amount: null };
	}

	// Confidence-based multiplier
	const confidenceMultiplier =
		analysis.confidence <= 50 ? 0.25 : 1.0;

	// Trade sizing: base * scale * multiplier, clamped
	const scale = Math.min(scoreDiff / 50, 2);
	let tradeSize = BASE_TRADE_USDC * scale * confidenceMultiplier;
	tradeSize = Math.max(MIN_TRADE_USDC, Math.min(MAX_TRADE_USDC, tradeSize));
	tradeSize = Math.round(tradeSize);

	const tradeAmount = BigInt(tradeSize) * 1_000_000n; // USDC 6 decimals

	runtime.log(
		`[TRADE] ${analysis.recommendation} → ${tradeSize} USDC (confidence=${analysis.confidence}, scale=${scale.toFixed(2)}, multiplier=${confidenceMultiplier})`,
	);

	if (!network) {
		runtime.log("[TRADE] No network available. Logging signal only.");
		return { executed: false, amount: tradeSize };
	}

	// Execute BUY_RISK via private transaction
	if (analysis.recommendation === "BUY_RISK") {
		const evmClient = new EVMClient(network.chainSelector.selector);
		const writeCallData = encodeFunctionData({
			abi: RISK_MARKET_ABI,
			functionName: "buyRisk",
			args: [tradeAmount],
		});

		const result = privateTransact(runtime, evmClient, {
			receiver: config.riskMarketAddress,
			callData: writeCallData,
			gasLimit: config.gasLimit ?? "500000",
			label: "RiskMarket.buyRisk",
		});

		if (result.success) {
			lastTradeScore = analysis.riskScore;
			lastTradeTimestamp = now;
			return { executed: true, amount: tradeSize };
		}
	}

	// Execute SELL_RISK (signal only — CRE wallet has no RISK inventory yet)
	if (analysis.recommendation === "SELL_RISK") {
		runtime.log(
			"[TRADE] SELL_RISK signal logged (CRE wallet has no RISK inventory yet)",
		);
		lastTradeScore = analysis.riskScore;
		lastTradeTimestamp = now;
		return { executed: true, amount: tradeSize };
	}

	return { executed: false, amount: tradeSize };
}

// ══════════════════════════════════════════════════════════════════════════
//  Main Handler
// ══════════════════════════════════════════════════════════════════════════

interface AgentResult {
	action?: string;
	reason?: string;
	recommendation?: string;
	riskScore?: number;
	confidence?: number;
	reasoning?: string;
	marketPrice?: number;
	zone?: string;
	error?: string;
	tradeAmountUsdc?: number;
	decisionCount?: number;
}

const onCronTrigger = (runtime: Runtime<Config>): AgentResult => {
	const config = runtime.config;
	const cycleId = `cycle-${++cycleCounter}`;
	runtime.log(
		`=== AI Risk Agent [${cycleId}]: ${config.monitoredProtocol} ===`,
	);
	resetPrivacyReport();

	const confidentialHTTP = new ConfidentialHTTPClient();

	// ── 1. Fetch all data sources ─────────────────────────────────────
	const data = fetchAllSources(runtime, confidentialHTTP, config);
	if (!data) {
		return { action: "skip", reason: "tvl_fetch_error" };
	}

	// ── 2. Read on-chain market state ─────────────────────────────────
	const network = getNetwork({
		chainFamily: "evm",
		chainSelectorName: config.chainSelectorName,
		isTestnet: true,
	});

	let currentPrice = 2;
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
			currentPrice = Number(
				decodeFunctionResult({
					abi: RISK_MARKET_ABI,
					functionName: "getCurrentRiskPrice",
					data: bytesToHex(priceResult.data),
				}),
			);

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
	runtime.log(`Market: price=${currentPrice}%, zone=${zoneName}`);

	// ── 3. AI Risk Analysis (LLM first, fallback second) ─────────────
	let analysis: LLMAnalysis;
	let fallbackUsed = false;

	const llmResult = analyzeWithLLM(
		runtime,
		confidentialHTTP,
		data,
		config,
		currentPrice,
		zoneName,
	);

	if (llmResult) {
		analysis = llmResult;
	} else {
		fallbackUsed = true;
		analysis = calculateFallbackScore(data);
		lastLlmAnalysis = analysis;
		runtime.log(
			`[FALLBACK] score=${analysis.riskScore} confidence=${analysis.confidence} rec=${analysis.recommendation}`,
		);
		runtime.log(`[FALLBACK] signals: [${analysis.signals.join(", ")}]`);
	}

	// ── 4. Trading decision with hysteresis ───────────────────────────
	const tradeResult = executeTrade(
		runtime,
		analysis,
		currentPrice,
		network,
		config,
	);

	// ── 5. Log structured decision ────────────────────────────────────
	const decision: AgentDecision = {
		timestamp: Date.now(),
		cycleId,
		dataSnapshot: data,
		llmAnalysis: fallbackUsed ? null : analysis,
		fallbackUsed,
		finalScore: analysis.riskScore,
		finalConfidence: analysis.confidence,
		recommendation: analysis.recommendation,
		tradeExecuted: tradeResult.executed,
		tradeAmount: tradeResult.amount,
		reasoning: analysis.reasoning,
	};

	// Structured decision log for observability
	runtime.log(`[DECISION] ${JSON.stringify(decision)}`);

	logPrivacyStatus(runtime);

	return {
		recommendation: analysis.recommendation,
		riskScore: analysis.riskScore,
		confidence: analysis.confidence,
		reasoning: analysis.reasoning,
		marketPrice: currentPrice,
		zone: zoneName,
		tradeAmountUsdc: tradeResult.amount ?? undefined,
		decisionCount: cycleCounter,
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
