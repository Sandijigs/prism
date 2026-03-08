# PRISM Protocol

**Intelligent Risk Markets for DeFi Protection**

PRISM creates continuous prediction markets that price DeFi protocol risk in real time. When risk rises, Chainlink CRE workflows automatically trigger graduated protective actions — no human intervention required.

Built for the **Chainlink Convergence Hackathon 2026**.

## Demo Video

[![PRISM Protocol Demo](https://img.youtube.com/vi/NDcRUl0AEHA/maxresdefault.jpg)](https://youtu.be/NDcRUl0AEHA)

## Live TestNet

**Tenderly Virtual TestNet Explorer:** https://dashboard.tenderly.co/sasha_bey/project/testnet/91cd6067-7154-43a7-8b3d-314ec3f799f3

Chain ID: `73571` | Public RPC: `https://virtual.mainnet.eu.rpc.tenderly.co/9ecfd80e-d72d-478b-b72f-a9b7997bfd84`

## Architecture

```
[pok/                Solidity smart contracts (Foundry, Solc 0.8.24)
cre-workflows/       Chainlink CRE workflows (TypeScript)
frontend/            Web UI (Next.js 15 + thirdweb v5)
docs/                Documentation and specs
```

## Multi-Protocol Extensibility

PRISM is designed as **one RiskMarket per protocol**. The monitored protocol is a config value — not hardcoded logic:

```
CRE workflow configs → "monitoredProtocol": "aave"
DeFiLlama API        → https://api.llama.fi/tvl/{monitoredProtocol}
```

To add a new protocol (e.g. Compound, Lido, MakerDAO), you deploy a fresh set of contracts and update the config:

```
┌─────────────────────────────────────────────┐
│  PRISM Instance #1  — monitoredProtocol: "aave"       │
│  RiskMarket → ShieldVault → InsurancePool              │
│  5 CRE workflows watching Aave TVL                     │
├─────────────────────────────────────────────┤
│  PRISM Instance #2  — monitoredProtocol: "compound-v3" │
│  RiskMarket → ShieldVault → InsurancePool              │
│  5 CRE workflows watching Compound TVL                 │
└─────────────────────────────────────────────┘
```

The smart contracts are protocol-agnostic — they only track a risk price. Any of the 3,000+ protocols on DeFiLlama can be monitored by changing a single config string. For the hackathon, Aave is used as the reference protocol due to its large TVL (~$14.7B) and recognizability.

## Quick Start

### Contracts

```bash
cd "[pok"
forge build
forge test -vvv
```

### CRE Workflows

```bash
cd cre-workflows
npm install
npm run build
```

### CRE Live Demo

Run a live demo with real on-chain transactions showing the full risk lifecycle:

```bash
cd cre-workflows
npm run demo           # live on-chain demo
npm run simulate       # read-only simulation (7/7 steps)
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

## Chainlink CRE Integration — File Index

All files that use Chainlink CRE SDK (`@chainlink/cre-sdk`):

### CRE Workflows (5 Production Workflows)

| Workflow | File | CRE Features | External Data |
|----------|------|-------------|---------------|
| Risk Monitor | [`cre-workflows/src/risk-monitor/index.ts`](cre-workflows/src/risk-monitor/index.ts) | CronCapability, ConfidentialHTTP, EVMClient, DON consensus | DeFiLlama TVL API |
| AI Risk Agent | [`cre-workflows/src/ai-risk-agent/index.ts`](cre-workflows/src/ai-risk-agent/index.ts) | CronCapability, ConfidentialHTTP (4x), EVMClient, LLM | DeFiLlama, CoinGecko, GitHub, Gemini LLM |
| Threshold Controller | [`cre-workflows/src/threshold-controller/index.ts`](cre-workflows/src/threshold-controller/index.ts) | CronCapability, EVMClient, privateTransact, 3-retry backoff | On-chain only |
| Reserve Verifier | [`cre-workflows/src/reserve-verifier/index.ts`](cre-workflows/src/reserve-verifier/index.ts) | CronCapability, ConfidentialHTTP, EVMClient | DeFiLlama TVL API |
| World ID Verifier | [`cre-workflows/src/world-id-verifier/index.ts`](cre-workflows/src/world-id-verifier/index.ts) | CronCapability, ConfidentialHTTP, EVMClient, cross-chain relay | World ID API |

### Workflow Configs (YAML)

- [`cre-workflows/src/risk-monitor/workflow.yaml`](cre-workflows/src/risk-monitor/workflow.yaml)
- [`cre-workflows/src/ai-risk-agent/workflow.yaml`](cre-workflows/src/ai-risk-agent/workflow.yaml)
- [`cre-workflows/src/threshold-controller/workflow.yaml`](cre-workflows/src/threshold-controller/workflow.yaml)
- [`cre-workflows/src/reserve-verifier/workflow.yaml`](cre-workflows/src/reserve-verifier/workflow.yaml)
- [`cre-workflows/src/world-id-verifier/workflow.yaml`](cre-workflows/src/world-id-verifier/workflow.yaml)

### Shared CRE Utilities

- [`cre-workflows/src/shared/confidential-http.ts`](cre-workflows/src/shared/confidential-http.ts) — Privacy audit tracking for ConfidentialHTTPClient
- [`cre-workflows/src/shared/private-tx.ts`](cre-workflows/src/shared/private-tx.ts) — Private transaction wrapper (MEV protection)
- [`cre-workflows/src/shared/secrets.ts`](cre-workflows/src/shared/secrets.ts) — CRE Runtime secrets management

### CRE Project Config

- [`cre-workflows/project.yaml`](cre-workflows/project.yaml) — Top-level CRE project configuration
- [`cre-workflows/config/project.yaml`](cre-workflows/config/project.yaml) — Workflow schedules, network settings, privacy parameters

### Demo & Simulation

- [`cre-workflows/src/demo-live.ts`](cre-workflows/src/demo-live.ts) — Live on-chain demo executing all 5 CRE workflows with real transactions
- [`cre-workflows/src/simulate.ts`](cre-workflows/src/simulate.ts) — Read-only 7-step CRE simulation framework

### Smart Contracts (CRE-Integrated)

- [`[pok/src/RiskMarket.sol`]([pok/src/RiskMarket.sol) — `creWorkflow` address for CRE-authorized trades and market resolution
- [`[pok/src/ShieldVault.sol`]([pok/src/ShieldVault.sol) — `triggerProtection(zone)` callable by CRE workflow
- [`[pok/src/InsurancePool.sol`]([pok/src/InsurancePool.sol) — `pauseNewShields()`, `updatePoolHealth()` callable by CRE workflow
- [`[pok/src/WorldIDGate.sol`]([pok/src/WorldIDGate.sol) — `mockVerify()`, `verifyCrossChain()` callable by CRE workflow

## License

MIT
