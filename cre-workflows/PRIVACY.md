# PRISM Protocol — CRE Privacy Architecture

## Overview

PRISM uses Chainlink CRE's privacy features to protect sensitive data at every layer of the protocol. This document describes the privacy measures implemented across all five CRE workflows.

## Privacy Layers

### 1. Confidential HTTP

**What it protects:** External API calls (LLM keys, market data, identity verification)

All external HTTP requests are routed through CRE's `ConfidentialHTTPClient`, which encrypts request/response payloads end-to-end through DON Trusted Execution Environments (TEEs).

| Workflow | API Calls | Encrypted Output |
|---|---|---|
| Risk Monitor | DeFiLlama TVL | No (public data) |
| AI Risk Agent | DeFiLlama, Stablecoins, GitHub, CoinGecko, LLM | LLM: Yes, Others: No |
| Reserve Verifier | DeFiLlama TVL | No (public data) |
| World ID Verifier | World ID API | Yes (identity data) |
| Threshold Controller | None | N/A |

**Key guarantees:**
- API keys (LLM, World ID) never appear in DON consensus messages
- LLM analysis (risk scores, recommendations) stays encrypted between workflow and API
- Identity verification data never leaves the TEE unencrypted

**Implementation:** `src/shared/confidential-http.ts`

### 2. Private Transactions

**What it protects:** On-chain write calldata (trade amounts, protection triggers, identity linkage)

All on-chain writes go through `privateTransact()`, which submits transactions via the CRE DON's private transaction pipeline. In production, this routes through private mempools to prevent:

- **Front-running:** MEV bots cannot see risk trades before execution
- **Strategy leaking:** Trade amounts and timing are hidden from block explorers
- **Panic cascading:** Emergency protection triggers are not visible until mined

| Workflow | Private Operations |
|---|---|
| Risk Monitor | `buyRisk` trades |
| AI Risk Agent | `buyRisk` / `sellRisk` trades |
| Threshold Controller | `triggerProtection`, `updatePoolHealth`, `pauseNewShields`, `resumeNewShields` |
| Reserve Verifier | `pauseNewShields` |
| World ID Verifier | `mockVerify` (identity ↔ address linkage) |

**Implementation:** `src/shared/private-tx.ts`

### 3. Secrets Management

**What it protects:** API keys, RPC URLs, private keys

Secrets are managed through a typed `CRESecrets` interface with:
- `loadSecrets()` — extracts secrets from CRE Runtime config (injected by the platform)
- `redact()` / `redactSecrets()` — masks sensitive values before logging
- `validateSecrets()` — verifies required secrets are present at startup

In production CRE, secrets are stored in the platform's encrypted secrets store and are only accessible inside DON TEEs. They never touch disk, logs, or consensus messages.

**Implementation:** `src/shared/secrets.ts`

**Configuration:**
- `config/secrets.example.yaml` — template (committed to git)
- `config/secrets.yaml` — actual values (gitignored, never committed)

## Privacy Audit Checklist

- [x] All HTTP calls use `ConfidentialHTTPClient` (no raw `fetch` or `HTTPClient`)
- [x] LLM API key passed via encrypted Confidential HTTP, not in URL parameters visible to DON
- [x] All on-chain writes use `privateTransact()` wrapper
- [x] `secrets.yaml` is in `.gitignore`
- [x] No hardcoded API keys or private keys in source code
- [x] Sensitive values are redacted before logging
- [x] World ID verification data encrypted in DON consensus (`encryptOutput: true`)
- [x] Privacy status logged at end of each workflow cycle for auditability

## File Structure

```
cre-workflows/
  src/
    shared/
      secrets.ts              # Secrets management (load, redact, validate)
      confidential-http.ts    # Confidential HTTP wrapper + privacy logging
      private-tx.ts           # Private transaction wrapper + audit logging
    risk-monitor/             # Uses: Confidential HTTP + Private TX
    ai-risk-agent/            # Uses: Confidential HTTP + Private TX
    threshold-controller/     # Uses: Private TX
    reserve-verifier/         # Uses: Confidential HTTP + Private TX
    world-id-verifier/        # Uses: Confidential HTTP + Private TX
  config/
    secrets.example.yaml      # Template for secrets (safe to commit)
    project.yaml              # Non-sensitive project config
    addresses.json            # Deployed contract addresses
```
