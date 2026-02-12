/**
 * World ID Verifier Workflow
 *
 * Verifies user identities via World ID protocol to enable sybil-resistant
 * trading weights in the RiskMarket. In production, this would verify real
 * World ID proofs via the World ID API using Confidential HTTP. For the
 * hackathon demo, it uses mock verification mode.
 *
 * Pattern: cron trigger -> (optional: Confidential HTTP World ID API) -> EVM write
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
	worldIdGateAddress: z.string(),
	riskMarketAddress: z.string(),
	chainRpcUrl: z.string(),
	chainSelectorName: z.string(),
	worldIdApiUrl: z.string().optional(),
	testAddresses: z.array(z.string()).optional(),
	gasLimit: z.string().optional(),
});

type Config = z.infer<typeof configSchema>;

// ── WorldIDGate ABI ─────────────────────────────────────────────────────

const WORLD_ID_GATE_ABI = [
	{
		name: "mockVerify",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "user", type: "address" }],
		outputs: [],
	},
	{
		name: "isVerified",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "user", type: "address" }],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;

// ── Helper: Decode Confidential HTTP Response ──────────────────────────

function decodeBody(bodyBytes: Uint8Array): string {
	return new TextDecoder().decode(bodyBytes);
}

// ── World ID Verification ───────────────────────────────────────────────

type VerificationResult = {
	success: boolean;
	verified: boolean;
	method: "real" | "mock";
	error?: string;
};

/**
 * Verify a user via World ID API using Confidential HTTP.
 * Falls back to mock mode if API is not configured or fails.
 */
const verifyUser = (
	sendRequester: ConfidentialHTTPSendRequester,
	config: Config,
	userAddress: string,
): VerificationResult => {
	// Check if World ID API is configured
	if (!config.worldIdApiUrl || config.worldIdApiUrl === "") {
		// Mock mode - always verify successfully for demo
		return {
			success: true,
			verified: true,
			method: "mock",
		};
	}

	// Attempt real World ID verification via Confidential HTTP
	try {
		const response = sendRequester
			.sendRequest({
				request: {
					url: config.worldIdApiUrl,
					method: "POST",
					bodyString: JSON.stringify({
						address: userAddress,
						// In production: include proof, merkle_root, nullifier_hash, etc.
					}),
					multiHeaders: {
						"Content-Type": { values: ["application/json"] },
					},
				},
				encryptOutput: true, // Keep verification private in DON enclave
			})
			.result();

		// Check status manually (Confidential HTTP doesn't have ok() helper)
		if (response.statusCode >= 200 && response.statusCode < 300) {
			const bodyText = decodeBody(response.body);
			const data = JSON.parse(bodyText);

			return {
				success: true,
				verified: data.verified === true,
				method: "real",
			};
		}

		// API call succeeded but returned non-2xx status
		return {
			success: false,
			verified: false,
			method: "real",
			error: `World ID API returned status ${response.statusCode}`,
		};
	} catch (err) {
		// Real verification failed - fall back to mock mode
		return {
			success: true,
			verified: true,
			method: "mock",
			error: `World ID API failed: ${String(err)}. Using mock mode.`,
		};
	}
};

// ── Main Handler ────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>) => {
	const config = runtime.config;

	runtime.log("=== World ID Verifier: Identity Verification ===");

	// Determine verification mode
	const useMockMode = !config.worldIdApiUrl || config.worldIdApiUrl === "";
	runtime.log(
		`Mode: ${useMockMode ? "MOCK (demo)" : "REAL (production)"} verification`,
	);

	// ── 1. Set up EVM client ─────────────────────────────────────────
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

	// ── 2. Get list of addresses to verify ──────────────────────────
	// In production: would query pending verification requests from contract events
	// For demo: use test addresses from config
	const addressesToVerify = config.testAddresses ?? [];

	if (addressesToVerify.length === 0) {
		runtime.log("No addresses to verify. Exiting.");
		return { action: "no_pending_verifications", verifiedCount: 0 };
	}

	runtime.log(`Found ${addressesToVerify.length} address(es) to verify`);

	// ── 3. Verify each address ──────────────────────────────────────
	let verifiedCount = 0;
	const gasLimit = config.gasLimit ?? "300000";

	for (const userAddress of addressesToVerify) {
		runtime.log(`Verifying user: ${userAddress}`);

		// Check if already verified
		let alreadyVerified = false;
		try {
			const callData = encodeFunctionData({
				abi: WORLD_ID_GATE_ABI,
				functionName: "isVerified",
				args: [userAddress as Address],
			});

			const result = evmClient
				.callContract(runtime, {
					call: encodeCallMsg({
						from: zeroAddress,
						to: config.worldIdGateAddress as Address,
						data: callData,
					}),
					blockNumber: LATEST_BLOCK_NUMBER,
				})
				.result();

			alreadyVerified = decodeFunctionResult({
				abi: WORLD_ID_GATE_ABI,
				functionName: "isVerified",
				data: bytesToHex(result.data),
			});

			if (alreadyVerified) {
				runtime.log(`User ${userAddress} already verified. Skipping.`);
				continue;
			}
		} catch (err) {
			runtime.log(
				`Failed to check verification status: ${String(err)}. Proceeding with verification.`,
			);
		}

		// Attempt verification
		let verificationResult: VerificationResult;

		if (useMockMode) {
			// Mock mode - directly return success
			verificationResult = {
				success: true,
				verified: true,
				method: "mock",
			};
		} else {
			// Real verification via Confidential HTTP
			const confidentialHTTP = new ConfidentialHTTPClient();
			verificationResult = confidentialHTTP
				.sendRequest(runtime, verifyUser, consensusMedianAggregation())(
					config,
					userAddress,
				)
				.result();
		}

		// Log verification result
		if (verificationResult.error) {
			runtime.log(`Note: ${verificationResult.error}`);
		}

		if (!verificationResult.verified) {
			runtime.log(
				`User ${userAddress} failed verification. Not updating contract.`,
			);
			continue;
		}

		runtime.log(
			`User ${userAddress} verified via ${verificationResult.method} method`,
		);

		// ── 4. Update WorldIDGate contract ──────────────────────────
		const mockVerifyData = encodeFunctionData({
			abi: WORLD_ID_GATE_ABI,
			functionName: "mockVerify",
			args: [userAddress as Address],
		});

		try {
			const report = runtime
				.report(prepareReportRequest(mockVerifyData))
				.result();

			const resp = evmClient
				.writeReport(runtime, {
					receiver: config.worldIdGateAddress,
					report,
					gasConfig: { gasLimit: BigInt(gasLimit) },
				})
				.result();

			if (resp.txStatus !== TxStatus.SUCCESS) {
				runtime.log(
					`WorldIDGate.mockVerify failed for ${userAddress}: ${resp.errorMessage ?? `status=${resp.txStatus}`}`,
				);
			} else {
				runtime.log(`Updated WorldIDGate: ${userAddress} verified on-chain`);
				verifiedCount++;
			}
		} catch (err) {
			runtime.log(`Error updating WorldIDGate: ${String(err)}`);
		}
	}

	runtime.log(
		`[WORLD_ID_VERIFIER] Verified ${verifiedCount} user(s) successfully`,
	);

	return {
		action: "verification_complete",
		verifiedCount,
		mode: useMockMode ? "mock" : "real",
		totalAddresses: addressesToVerify.length,
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
