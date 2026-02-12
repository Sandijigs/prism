import { z } from "zod";

// ── Config Schema ────────────────────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	riskMarketAddress: z.string(),
	chainRpcUrl: z.string(),
	defiLlamaApiUrl: z.string(),
	monitoredProtocol: z.string(),
});

export type Config = z.infer<typeof configSchema>;

// ── Risk Assessment ──────────────────────────────────────────────────────

export interface RiskAssessment {
	protocol: string;
	currentTvl: number;
	previousTvl: number;
	tvlChangePercent: number;
	riskScore: number;
	currentMarketPrice: number;
	action: "none" | "buy" | "sell";
	timestamp: number;
}
