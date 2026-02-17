/**
 * Confidential HTTP Privacy Tracking
 *
 * Provides privacy audit tracking for CRE's ConfidentialHTTPClient usage.
 * Workflows call the CRE SDK's ConfidentialHTTPClient directly, and use
 * these utilities to log and audit which requests use encryption.
 *
 * In CRE, Confidential HTTP ensures that:
 *   - Request/response bodies are encrypted between the workflow and external APIs
 *   - API keys never appear in DON consensus messages or on-chain
 *   - Only the final aggregated result is visible to the broader DON
 *
 * Usage in workflows:
 *   import { trackConfidentialRequest, logPrivacyStatus } from "../shared/confidential-http";
 *   trackConfidentialRequest(runtime, "DeFiLlama TVL", false);
 *   const data = confidentialHTTP.sendRequest(runtime, fetchFn, aggregation)(config).result();
 */

import type { Runtime } from "@chainlink/cre-sdk";

// ── Types ────────────────────────────────────────────────────────────────

export interface PrivacyReport {
	confidentialHttpUsed: boolean;
	encryptedOutputs: string[];
	plainOutputs: string[];
	totalRequests: number;
}

// ── Module State ─────────────────────────────────────────────────────────

const privacyReport: PrivacyReport = {
	confidentialHttpUsed: false,
	encryptedOutputs: [],
	plainOutputs: [],
	totalRequests: 0,
};

// ── Tracking ────────────────────────────────────────────────────────────

/**
 * Track a Confidential HTTP request for privacy auditing.
 * Call this before each ConfidentialHTTPClient.sendRequest() call.
 *
 * @param runtime   CRE Runtime instance (for logging)
 * @param label     Human-readable request label (e.g., "DeFiLlama TVL")
 * @param encrypted Whether encryptOutput is true for this request
 */
export function trackConfidentialRequest<TConfig>(
	runtime: Runtime<TConfig>,
	label: string,
	encrypted: boolean,
): void {
	privacyReport.confidentialHttpUsed = true;
	privacyReport.totalRequests++;

	if (encrypted) {
		privacyReport.encryptedOutputs.push(label);
	} else {
		privacyReport.plainOutputs.push(label);
	}

	runtime.log(
		`[PRIVACY] Confidential HTTP: ${label} (encrypted=${encrypted})`,
	);
}

// ── Privacy Status Logging ──────────────────────────────────────────────

/**
 * Log a summary of privacy measures used during this workflow cycle.
 * Call at the end of each workflow handler to audit privacy compliance.
 */
export function logPrivacyStatus<TConfig>(
	runtime: Runtime<TConfig>,
): void {
	runtime.log("--- PRIVACY STATUS ---");
	runtime.log(
		`Confidential HTTP: ${privacyReport.confidentialHttpUsed ? "ACTIVE" : "NOT USED"}`,
	);
	runtime.log(`Total requests: ${privacyReport.totalRequests}`);

	if (privacyReport.encryptedOutputs.length > 0) {
		runtime.log(
			`Encrypted outputs: [${privacyReport.encryptedOutputs.join(", ")}]`,
		);
	}
	if (privacyReport.plainOutputs.length > 0) {
		runtime.log(
			`Plain outputs: [${privacyReport.plainOutputs.join(", ")}]`,
		);
	}
	runtime.log("--- END PRIVACY STATUS ---");
}

/**
 * Reset privacy report counters. Call at the start of each cycle
 * to get per-cycle privacy stats.
 */
export function resetPrivacyReport(): void {
	privacyReport.confidentialHttpUsed = false;
	privacyReport.encryptedOutputs = [];
	privacyReport.plainOutputs = [];
	privacyReport.totalRequests = 0;
}

/**
 * Get a snapshot of the current privacy report.
 */
export function getPrivacyReport(): Readonly<PrivacyReport> {
	return { ...privacyReport };
}
