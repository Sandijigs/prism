/**
 * CRE Secrets Management
 *
 * Centralizes access to sensitive configuration values (API keys, private keys,
 * RPC URLs) that must never leak into logs, on-chain calldata, or DON consensus
 * messages. In production CRE, secrets are injected via the platform's encrypted
 * secrets store and accessed through Runtime.config — never from environment
 * variables or hardcoded values.
 *
 * This module provides:
 *   1. A typed CRESecrets interface for all PRISM secrets
 *   2. loadSecrets() to extract secrets from a CRE config object
 *   3. redact() to mask secrets before logging
 *   4. validateSecrets() to verify required secrets are present at startup
 */

import type { Runtime } from "@chainlink/cre-sdk";

// ── Secret Keys ──────────────────────────────────────────────────────────

export interface CRESecrets {
	/** LLM API key (Gemini) for AI risk analysis */
	llmApiKey: string;
	/** RPC URL for the target chain */
	chainRpcUrl: string;
	/** World ID API credentials (optional — mock mode if absent) */
	worldIdApiKey?: string;
	/** DeFiLlama API URL (public, but treat as configurable) */
	defiLlamaApiUrl: string;
	/** GitHub API URL (public, but treat as configurable) */
	githubApiUrl?: string;
	/** CoinGecko API URL (public, but treat as configurable) */
	coinGeckoApiUrl?: string;
}

// Keys that are truly sensitive and must be redacted in logs
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
	"llmApiKey",
	"chainRpcUrl",
	"worldIdApiKey",
]);

// ── Load Secrets from CRE Config ─────────────────────────────────────────

/**
 * Extract secrets from a CRE Runtime config object.
 * In production CRE, these values come from the encrypted secrets store
 * and are only accessible inside the DON TEE.
 */
export function loadSecrets(config: Record<string, unknown>): CRESecrets {
	return {
		llmApiKey: String(config.llmApiKey ?? ""),
		chainRpcUrl: String(config.chainRpcUrl ?? ""),
		worldIdApiKey: config.worldIdApiKey
			? String(config.worldIdApiKey)
			: undefined,
		defiLlamaApiUrl: String(
			config.defiLlamaApiUrl ?? "https://api.llama.fi",
		),
		githubApiUrl: config.githubApiUrl
			? String(config.githubApiUrl)
			: undefined,
		coinGeckoApiUrl: config.coinGeckoApiUrl
			? String(config.coinGeckoApiUrl)
			: undefined,
	};
}

// ── Redaction ────────────────────────────────────────────────────────────

/**
 * Redact a secret value for safe logging.
 * Shows first 4 chars + "***" for non-empty values, or "[empty]".
 */
export function redact(value: string | undefined): string {
	if (!value || value.length === 0) return "[empty]";
	if (value.length <= 4) return "***";
	return `${value.slice(0, 4)}***`;
}

/**
 * Redact all sensitive fields in a secrets object for logging.
 */
export function redactSecrets(
	secrets: CRESecrets,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(secrets)) {
		if (value === undefined) continue;
		result[key] = SENSITIVE_KEYS.has(key) ? redact(value) : value;
	}
	return result;
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Validate that required secrets are present. Returns an array of
 * missing secret names (empty array = all good).
 */
export function validateSecrets(
	secrets: CRESecrets,
	required: Array<keyof CRESecrets> = ["llmApiKey", "chainRpcUrl"],
): string[] {
	const missing: string[] = [];
	for (const key of required) {
		const val = secrets[key];
		if (!val || val.length === 0) {
			missing.push(key);
		}
	}
	return missing;
}

/**
 * Log a privacy-safe summary of loaded secrets to the CRE runtime.
 */
export function logSecretsStatus<TConfig>(
	runtime: Runtime<TConfig>,
	secrets: CRESecrets,
): void {
	const redacted = redactSecrets(secrets);
	runtime.log("[SECRETS] Loaded secrets (redacted):");
	for (const [key, value] of Object.entries(redacted)) {
		runtime.log(`  ${key}: ${value}`);
	}
}
