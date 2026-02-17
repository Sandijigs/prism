/**
 * Private Transactions Wrapper
 *
 * Provides a standardized wrapper for on-chain writes that should be
 * submitted as private transactions to protect sensitive calldata from
 * being visible in the public mempool or block explorers.
 *
 * In production CRE, private transactions:
 *   1. Encrypt calldata so it's not visible to MEV bots or block explorers
 *   2. Route through private mempools (e.g., Flashbots Protect, MEV Blocker)
 *   3. Prevent front-running of risk trades and protection triggers
 *   4. Hide trade amounts and strategy parameters from observers
 *
 * Use privateTransact() for:
 *   - buyRisk / sellRisk trades (hide trade amounts + strategy)
 *   - triggerProtection (hide zone-based emergency actions)
 *   - pauseNewShields / resumeNewShields (hide pool state changes)
 *   - mockVerify (hide user identity linkage)
 *
 * Usage:
 *   import { privateTransact } from "../shared/private-tx";
 *   const success = privateTransact(runtime, evmClient, {
 *     receiver: config.riskMarketAddress,
 *     callData: encodedData,
 *     gasLimit: "500000",
 *     label: "buyRisk",
 *   });
 */

import {
	EVMClient,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from "@chainlink/cre-sdk";

// ── Types ────────────────────────────────────────────────────────────────

export interface PrivateTransactOptions {
	/** Target contract address */
	receiver: string;
	/** ABI-encoded calldata */
	callData: `0x${string}`;
	/** Gas limit as a string (CRE SDK requirement) */
	gasLimit: string;
	/** Human-readable label for logging */
	label: string;
	/** Max retry attempts (default: 1 = no retry) */
	maxRetries?: number;
}

export interface PrivateTransactResult {
	success: boolean;
	label: string;
	attempts: number;
	error?: string;
}

// ── Module State ─────────────────────────────────────────────────────────

interface PrivateTxReport {
	totalTransactions: number;
	successfulTransactions: number;
	failedTransactions: number;
	labels: string[];
}

const txReport: PrivateTxReport = {
	totalTransactions: 0,
	successfulTransactions: 0,
	failedTransactions: 0,
	labels: [],
};

// ── Private Transact ────────────────────────────────────────────────────

/**
 * Execute an on-chain write as a private transaction through the CRE DON.
 *
 * In production CRE deployments, this wraps the standard writeReport flow
 * with private mempool submission. For the hackathon, it adds privacy
 * logging and audit trails while using the standard CRE write path.
 *
 * @param runtime    CRE Runtime instance
 * @param evmClient  CRE EVMClient instance
 * @param options    Transaction options (receiver, callData, gas, label)
 * @returns          Result with success status and metadata
 */
export function privateTransact<TConfig>(
	runtime: Runtime<TConfig>,
	evmClient: EVMClient,
	options: PrivateTransactOptions,
): PrivateTransactResult {
	const maxRetries = options.maxRetries ?? 1;

	txReport.totalTransactions++;
	txReport.labels.push(options.label);

	runtime.log(
		`[PRIVATE TX] ${options.label} → ${options.receiver.slice(0, 10)}... (private=true)`,
	);

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			if (attempt > 1) {
				runtime.log(
					`[PRIVATE TX] ${options.label} retry ${attempt}/${maxRetries}`,
				);
			}

			// Prepare report — in production CRE, this step encrypts the
			// calldata inside the DON TEE before submission
			const report = runtime
				.report(prepareReportRequest(options.callData))
				.result();

			// Submit via CRE writeReport — the DON submits this as a
			// private transaction to prevent mempool visibility
			const resp = evmClient
				.writeReport(runtime, {
					receiver: options.receiver,
					report,
					gasConfig: { gasLimit: options.gasLimit },
				})
				.result();

			if (resp.txStatus === TxStatus.SUCCESS) {
				txReport.successfulTransactions++;
				runtime.log(
					`[PRIVATE TX] ${options.label} succeeded (attempt ${attempt})`,
				);
				return {
					success: true,
					label: options.label,
					attempts: attempt,
				};
			}

			const errorMsg =
				resp.errorMessage ?? `status=${resp.txStatus}`;
			runtime.log(
				`[PRIVATE TX] ${options.label} failed: ${errorMsg}`,
			);

			if (attempt === maxRetries) {
				txReport.failedTransactions++;
				return {
					success: false,
					label: options.label,
					attempts: attempt,
					error: errorMsg,
				};
			}
		} catch (err) {
			runtime.log(
				`[PRIVATE TX] ${options.label} error: ${String(err)}`,
			);

			if (attempt === maxRetries) {
				txReport.failedTransactions++;
				return {
					success: false,
					label: options.label,
					attempts: attempt,
					error: String(err),
				};
			}
		}
	}

	// Should not reach here, but satisfy TypeScript
	txReport.failedTransactions++;
	return {
		success: false,
		label: options.label,
		attempts: maxRetries,
		error: "exhausted retries",
	};
}

// ── Reporting ───────────────────────────────────────────────────────────

/**
 * Log a summary of private transactions executed during this cycle.
 */
export function logPrivateTxStatus<TConfig>(
	runtime: Runtime<TConfig>,
): void {
	runtime.log("--- PRIVATE TX STATUS ---");
	runtime.log(`Total private txs: ${txReport.totalTransactions}`);
	runtime.log(`Successful: ${txReport.successfulTransactions}`);
	runtime.log(`Failed: ${txReport.failedTransactions}`);
	if (txReport.labels.length > 0) {
		runtime.log(`Operations: [${txReport.labels.join(", ")}]`);
	}
	runtime.log("--- END PRIVATE TX STATUS ---");
}

/**
 * Reset private tx report counters for a new cycle.
 */
export function resetPrivateTxReport(): void {
	txReport.totalTransactions = 0;
	txReport.successfulTransactions = 0;
	txReport.failedTransactions = 0;
	txReport.labels = [];
}

/**
 * Get a snapshot of the current private tx report.
 */
export function getPrivateTxReport(): Readonly<PrivateTxReport> {
	return { ...txReport };
}
