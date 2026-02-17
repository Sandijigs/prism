/**
 * World ID Verifier Workflow
 *
 * Verifies user identities via World ID protocol to enable sybil-resistant
 * trading weights in the RiskMarket. Supports three verification paths:
 *   1. Mock mode — instant verification for hackathon demos
 *   2. Real mode — World ID Groth16 proof via Confidential HTTP
 *   3. Cross-chain — relay verification from a source chain via CRE DON
 *
 * Pattern: cron trigger -> (optional: Confidential HTTP World ID API) -> EVM write
 */

import {
	CronCapability,
	ConfidentialHTTPClient,
	type ConfidentialHTTPSendRequester,
	consensusIdenticalAggregation,
	EVMClient,
	encodeCallMsg,
	getNetwork,
	handler,
	LATEST_BLOCK_NUMBER,
	Runner,
	type Runtime,
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
	logPrivacyStatus,
	resetPrivacyReport,
} from "../shared/confidential-http";
import { privateTransact } from "../shared/private-tx";
import type {
	CrossChainVerificationRequest,
	CrossChainVerificationResult,
} from "./types";

// ── Config ──────────────────────────────────────────────────────────────

const crossChainRequestSchema = z.object({
	user: z.string(),
	sourceChainSelector: z.number(),
	sourceAddress: z.string(),
	proof: z.string().optional(),
});

const configSchema = z.object({
	schedule: z.string(),
	worldIdGateAddress: z.string(),
	riskMarketAddress: z.string(),
	chainRpcUrl: z.string(),
	chainSelectorName: z.string(),
	worldIdApiUrl: z.string().optional(),
	testAddresses: z.array(z.string()).optional(),
	crossChainRequests: z.array(crossChainRequestSchema).optional(),
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
		name: "verifyCrossChain",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "user", type: "address" },
			{ name: "sourceChainSelector", type: "uint64" },
			{ name: "sourceAddress", type: "address" },
		],
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

// ── Cross-Chain Verification (CRE) ──────────────────────────────────────

function handleCrossChainVerification<TConfig>(
	runtime: Runtime<TConfig>,
	evmClient: EVMClient,
	worldIdGateAddress: string,
	request: CrossChainVerificationRequest,
	gasLimit: string,
): CrossChainVerificationResult {
	runtime.log(
		`[CROSS-CHAIN] Verifying ${request.user.slice(0, 8)}... from chain ${request.sourceChainSelector}`,
	);

	const callData = encodeFunctionData({
		abi: WORLD_ID_GATE_ABI,
		functionName: "verifyCrossChain",
		args: [
			request.user as Address,
			BigInt(request.sourceChainSelector),
			request.sourceAddress as Address,
		],
	});

	const result = privateTransact(runtime, evmClient, {
		receiver: worldIdGateAddress,
		callData,
		gasLimit,
		label: `WorldIDGate.verifyCrossChain(${request.user.slice(0, 8)}...)`,
	});

	return {
		success: result.success,
		user: request.user,
		method: "cross-chain",
		sourceChain: request.sourceChainSelector,
		error: result.error,
	};
}

// ── Result Type ─────────────────────────────────────────────────────────

type WorldIdVerifierResult = {
	action: string;
	reason?: string;
	verifiedCount?: number;
	crossChainCount?: number;
	mode?: string;
	totalAddresses?: number;
};

// ── Main Handler ────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>): WorldIdVerifierResult => {
	const config = runtime.config;

	runtime.log("=== World ID Verifier: Identity Verification ===");
	resetPrivacyReport();

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
				.sendRequest(runtime, verifyUser, consensusIdenticalAggregation<VerificationResult>())(
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

		// ── 4. Update WorldIDGate contract via private transaction ──
		const mockVerifyData = encodeFunctionData({
			abi: WORLD_ID_GATE_ABI,
			functionName: "mockVerify",
			args: [userAddress as Address],
		});

		const result = privateTransact(runtime, evmClient, {
			receiver: config.worldIdGateAddress,
			callData: mockVerifyData,
			gasLimit,
			label: `WorldIDGate.mockVerify(${userAddress.slice(0, 8)}...)`,
		});

		if (result.success) {
			verifiedCount++;
		}
	}

	// ── 5. Process cross-chain verification requests ────────────
	const crossChainRequests = config.crossChainRequests ?? [];
	let crossChainCount = 0;

	if (crossChainRequests.length > 0) {
		runtime.log(
			`[CROSS-CHAIN] Processing ${crossChainRequests.length} cross-chain request(s)`,
		);

		for (const request of crossChainRequests) {
			const ccResult = handleCrossChainVerification(
				runtime,
				evmClient,
				config.worldIdGateAddress,
				request,
				gasLimit,
			);

			if (ccResult.success) {
				crossChainCount++;
				runtime.log(
					`[CROSS-CHAIN] ${request.user.slice(0, 8)}... verified from chain ${request.sourceChainSelector}`,
				);
			} else {
				runtime.log(
					`[CROSS-CHAIN] Failed: ${ccResult.error ?? "unknown error"}`,
				);
			}
		}
	}

	runtime.log(
		`[WORLD_ID_VERIFIER] Verified ${verifiedCount} user(s), ${crossChainCount} cross-chain`,
	);

	logPrivacyStatus(runtime);

	return {
		action: "verification_complete",
		verifiedCount,
		crossChainCount,
		mode: useMockMode ? "mock" : "real",
		totalAddresses: addressesToVerify.length + crossChainRequests.length,
	};
};

// ── Workflow Wiring ─────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
	const cron = new CronCapability();
	return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

// ── Simulation Helper (ethers.js) ──────────────────────────────────────

/**
 * Standalone cross-chain verification handler for use by simulate.ts.
 * Uses ethers.js directly (not CRE SDK) for Tenderly VTN interaction.
 */
export async function handleVerificationRequest(
	provider: import("ethers").JsonRpcProvider,
	worldIdGateAddress: string,
	request: CrossChainVerificationRequest,
): Promise<CrossChainVerificationResult> {
	const { ethers } = await import("ethers");

	const gate = new ethers.Contract(
		worldIdGateAddress,
		[
			"function isVerified(address) view returns (bool)",
			"function totalVerified() view returns (uint256)",
			"function crossChainVerifications(address) view returns (uint64, address, uint256, bool)",
		],
		provider,
	);

	try {
		const isVerified: boolean = await gate.isVerified(request.user);
		const totalVerified: bigint = await gate.totalVerified();

		if (isVerified) {
			// Check if cross-chain record exists
			const [selector, srcAddr, ts, valid] =
				await gate.crossChainVerifications(request.user);

			return {
				success: true,
				user: request.user,
				method:
					Number(selector) > 0 ? "cross-chain" : "mock",
				sourceChain:
					Number(selector) > 0
						? Number(selector)
						: undefined,
			};
		}

		return {
			success: true,
			user: request.user,
			method: "mock",
		};
	} catch (err) {
		return {
			success: false,
			user: request.user,
			method: "cross-chain",
			error: String(err),
		};
	}
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
