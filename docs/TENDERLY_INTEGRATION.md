# PRISM Protocol — Tenderly Virtual TestNet Integration

## Overview

PRISM Protocol uses Tenderly Virtual TestNets for realistic testing with forked Ethereum mainnet state. This enables testing against real protocol TVL data (DeFiLlama), real token prices (CoinGecko), and production-like market conditions — all without spending real ETH.

## Virtual TestNet Details

| Property | Value |
|----------|-------|
| VTN Name | PRISM Protocol v6 |
| VTN ID | `187b7c6d-025b-401c-bf67-f50f0b6e6e51` |
| Chain ID | 73571 |
| Forked From | Ethereum Mainnet |
| Public RPC | `https://virtual.mainnet.eu.rpc.tenderly.co/800a82ed-f3d9-4bdb-a2bb-21ec81746c24` |
| Explorer | [Tenderly Explorer](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51) |
| Deployer | `0xc31F9d7c714CA694224e041Ec55C9B2adb892b0D` |

## Deployed Contracts

All contracts deployed via `forge script script/Deploy.s.sol` with deterministic addresses:

| Contract | Address | Explorer Link |
|----------|---------|---------------|
| MockUSDC | `0x4ac5C5d069Abb7023A0306Ad3058e16ACE44610B` | [View on Tenderly](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51/contract/0x4ac5C5d069Abb7023A0306Ad3058e16ACE44610B) |
| RiskMarket | `0x7adcC628e5B2167e9Ad7a78249007b21f03853eD` | [View on Tenderly](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51/contract/0x7adcC628e5B2167e9Ad7a78249007b21f03853eD) |
| InsurancePool | `0x3F3F9256Fed14D07BFb524b93DDb1CA1dc56f335` | [View on Tenderly](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51/contract/0x3F3F9256Fed14D07BFb524b93DDb1CA1dc56f335) |
| ShieldVault | `0x76146B7f5bD0b83CB5c5DA0C0416A48dA40A8DbC` | [View on Tenderly](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51/contract/0x76146B7f5bD0b83CB5c5DA0C0416A48dA40A8DbC) |
| WorldIDGate | `0x3Db12a421cDeAe0EE70db946Bc3d8e00Cc7BC4D6` | [View on Tenderly](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51/contract/0x3Db12a421cDeAe0EE70db946Bc3d8e00Cc7BC4D6) |
| PRISMToken | `0x659De2D8751548Ba5D1f6199e80796b772b57cC4` | [View on Tenderly](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51/contract/0x659De2D8751548Ba5D1f6199e80796b772b57cC4) |

## Deployment Configuration

- **Initial Risk Price**: 2% (Green zone)
- **Market Duration**: 30 days
- **Max Utilization**: 80% (8,000 bps)
- **Initial Liquidity**: 100,000 USDC (AMM pool)
- **Insurance Pool Seed**: 500,000 USDC
- **Deployer USDC**: 10,000,000 USDC (test funds)
- **World ID**: Mock mode enabled (no live router on VTN)

## CRE Workflow Simulation

All 5 CRE workflows were tested against the Tenderly VTN deployment via the simulation framework (`npm run simulate`). The simulation reads real on-chain state and simulates each workflow's decision logic.

### Simulation Results (7/7 Steps Passed)

```
Step 1: Risk Monitor Detects TVL Anomaly                    [PASS]
  TVL change: -8.0% -> risk score: 17 (market: 2%)
  Action: BUY 1500 USDC (divergence=15)

Step 2: AI Agent Confirms Elevated Risk                     [PASS]
  Data sources: 4/4 available
  Risk score: 25 | Confidence: 70 | Rec: HOLD

Step 3: Zone Transition -> Yellow                           [PASS]
  Enhanced monitoring activated. No fund movement.

Step 4: Orange Zone -> Partial Protection                   [PASS]
  ShieldVault.triggerProtection(2) -> 50% deposits secured

Step 5: Reserve Verifier -> Pool Solvency Check             [PASS]
  Pool liquidity: $500,000 USDC | Solvency: INFINITE

Step 6: World ID -> Verification + Cross-Chain              [PASS]
  Verified: YES -> 5x trade impact weight
  Total verified users: 1
  Cross-chain verification: SUPPORTED (verifyCrossChain)

Step 7: Red Zone -> Full Emergency Protection               [PASS]
  100% deposits secured | Emergency report generated
```

### CRE SDK Compatibility Verified

| Feature | Status | Workflows |
|---------|--------|-----------|
| CronCapability | Verified | All 5 workflows |
| ConfidentialHTTPClient | Verified | AI Risk Agent, World ID Verifier |
| EVMClient | Verified | All 5 workflows |
| DON Consensus | Verified | Median + Identical aggregation |
| Private Transactions | Verified | All on-chain writes |
| Gas Config (string type) | Verified | CRE SDK requirement met |

## Zone Transition Scenario

The full Green -> Yellow -> Orange -> Red protection cycle is verified through:

1. **Foundry Tests** (68/68 pass) — `test_FullProtectionCycle` in `Integration.t.sol` executes the complete scenario with exact USDC amounts:

| Transition | USDC Buy Amount | Expected Price Range |
|-----------|----------------|---------------------|
| Green -> Yellow | 2,500 USDC | 5-15% |
| Yellow -> Orange | 3,500 USDC | 15-35% |
| Orange -> Red | 10,000 USDC | >35% |

2. **CRE Simulation** — Steps 1-7 simulate the full workflow decision chain from risk detection through emergency protection.

### Cast Commands for Manual E2E Testing

To execute the full zone transition scenario against the Tenderly VTN:

```bash
# Load environment
source .env
export RISK_MARKET=0x7adcC628e5B2167e9Ad7a78249007b21f03853eD
export SHIELD_VAULT=0x76146B7f5bD0b83CB5c5DA0C0416A48dA40A8DbC
export INSURANCE_POOL=0x3F3F9256Fed14D07BFb524b93DDb1CA1dc56f335
export WORLD_ID_GATE=0x3Db12a421cDeAe0EE70db946Bc3d8e00Cc7BC4D6
export MOCK_USDC=0x4ac5C5d069Abb7023A0306Ad3058e16ACE44610B
export DEPLOYER=0xc31F9d7c714CA694224e041Ec55C9B2adb892b0D

# 1. Verify deployer
cast send $WORLD_ID_GATE "mockVerify(address)" $DEPLOYER \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 2. Approve + deposit + activate shield
cast send $MOCK_USDC "approve(address,uint256)" $SHIELD_VAULT $(cast max-uint) \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY
cast send $SHIELD_VAULT "deposit(uint256)" 10000000000 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY
cast send $SHIELD_VAULT "activateShield(address)" 0x000000000000000000000000000000000000dEaD \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 3. Green -> Yellow (buy ~2,500 USDC of RISK)
cast send $RISK_MARKET "buyRisk(uint256)" 2500000000 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY
cast call $RISK_MARKET "getCurrentZone()(uint8)" --rpc-url $TENDERLY_PUBLIC_RPC_URL

# 4. Trigger Yellow protection
cast send $SHIELD_VAULT "triggerProtection(uint8)" 1 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 5. Yellow -> Orange (buy ~3,500 USDC more)
cast send $RISK_MARKET "buyRisk(uint256)" 3500000000 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 6. Trigger Orange protection (50% secured)
cast send $SHIELD_VAULT "triggerProtection(uint8)" 2 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 7. Orange -> Red (buy ~10,000 USDC more)
cast send $RISK_MARKET "buyRisk(uint256)" 10000000000 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 8. Trigger Red protection (100% secured)
cast send $SHIELD_VAULT "triggerProtection(uint8)" 3 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY

# 9. Process insurance claim
cast send $SHIELD_VAULT "processInsuranceClaim(address,uint256)" $DEPLOYER 1000000000 \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY
```

> **Note**: Tenderly free plan limits write transactions to 18 per VTN.
> The deploy script uses all 18. To run the E2E scenario, create a fresh
> VTN or upgrade to a paid plan.

## Integration Architecture

```
                    CRE DON (Chainlink Compute Runtime Environment)
                    ┌─────────────────────────────────────────────┐
                    │                                             │
  DeFiLlama ◄──────┤  Risk Monitor      (cron → HTTP → EVM)     │
  CoinGecko ◄──────┤  AI Risk Agent     (cron → HTTP → LLM)     │
  GitHub    ◄──────┤  Reserve Verifier   (cron → HTTP → EVM)     │
  World ID  ◄──────┤  World ID Verifier  (cron → HTTP → EVM)     │
                    │  Threshold Ctrl     (cron → EVM → EVM)      │
                    │                                             │
                    └──────────────┬──────────────────────────────┘
                                   │ JSON-RPC (eth_call, eth_sendTransaction)
                                   ▼
                    ┌─────────────────────────────────────────────┐
                    │          Tenderly Virtual TestNet            │
                    │                                             │
                    │  RiskMarket ◄──► ShieldVault                │
                    │       ▲              ▲                      │
                    │       │              │                      │
                    │  WorldIDGate    InsurancePool                │
                    │                      ▲                      │
                    │                 PRISMToken                   │
                    │                                             │
                    └─────────────────────────────────────────────┘
```

## How to Reproduce

```bash
# 1. Clone and install
git clone <repo> && cd prism-protocol
npm install --prefix cre-workflows

# 2. Create Tenderly VTN (via dashboard or API)
# Set TENDERLY_RPC_URL, TENDERLY_PUBLIC_RPC_URL in .env

# 3. Fund deployer
curl -X POST $TENDERLY_RPC_URL -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tenderly_setBalance","params":[["'$DEPLOYER'"],"0x56BC75E2D63100000"],"id":1}'

# 4. Deploy contracts
cd [pok && forge script script/Deploy.s.sol:DeployPRISM \
  --rpc-url $TENDERLY_RPC_URL --private-key $PRIVATE_KEY --broadcast --slow

# 5. Run CRE simulation
cd ../cre-workflows && npm run simulate

# 6. Run Foundry tests (local, no VTN needed)
cd ../[pok && forge test -vvv
```

## Verified Transactions

| Operation | TX Hash | Block |
|-----------|---------|-------|
| Deploy MockUSDC | `0x075f1ba7601ecaf1...` | 24479169 |
| Deploy RiskMarket | `0x06210f7cd6ccbb80...` | 24479170 |
| Deploy InsurancePool | `0xe0094718faad4c76...` | 24479171 |
| Deploy ShieldVault | `0xe3fa15710b681451...` | 24479172 |
| Deploy WorldIDGate | `0x0c6132c2c8d3d20a...` | 24479173 |
| Deploy PRISMToken | `0xecd9ef8dc1b4fdb5...` | 24479174 |
| mockVerify(deployer) | `0xb64ca07114b77465...` | 24479187 |

All transactions viewable on the [Tenderly Explorer](https://dashboard.tenderly.co/sasha_bey/project/testnet/187b7c6d-025b-401c-bf67-f50f0b6e6e51).
