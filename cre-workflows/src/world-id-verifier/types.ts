/**
 * World ID Cross-Chain Verification Types
 */

export interface CrossChainVerificationRequest {
	/** User address to verify on the destination chain */
	user: string;
	/** Chainlink CCIP chain selector of the source chain */
	sourceChainSelector: number;
	/** User's address on the source chain */
	sourceAddress: string;
	/** ZK proof data (production — omitted in mock mode) */
	proof?: string;
}

export interface CrossChainVerificationResult {
	success: boolean;
	user: string;
	method: "cross-chain" | "mock" | "real";
	sourceChain?: number;
	error?: string;
}
