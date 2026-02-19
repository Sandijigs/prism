# Market Resolution Mechanism

## Overview

PRISM Protocol uses a **dual-authorization resolution system** powered by Chainlink CRE workflows, with owner fallback for safety.

## Resolution Authority

The market can be resolved by:
1. **CRE Workflow** (Primary) - Autonomous resolution via AI Risk Agent
2. **Owner** (Fallback) - Manual resolution for emergency situations

## How Resolution Works

### Contract Implementation

```solidity
function resolve(bool _lossEvent) external {
    if (msg.sender != owner() && msg.sender != creWorkflow) revert NotAuthorized();
    if (resolved) revert MarketAlreadyResolved();

    resolved = true;
    emit MarketResolved(_lossEvent, getCurrentRiskPrice());
}
```

### Parameters

- `_lossEvent`: `true` if the monitored protocol suffered a qualifying loss event (>$1M), `false` otherwise

### Resolution Flow

1. **Market Duration**: 30 days from creation
2. **Resolution Trigger**:
   - CRE workflow monitors protocol health continuously
   - At expiration, AI Risk Agent analyzes:
     - Historical protocol TVL
     - Recorded exploit events
     - DeFi news sources
     - On-chain transaction data
3. **Autonomous Decision**: CRE workflow calls `resolve(outcome)` with determined result
4. **Event Emission**: `MarketResolved(bool lossEvent, uint256 finalPrice)` emitted
5. **Trading Halt**: All buy/sell operations revert after resolution

## CRE Workflow Integration

### AI Risk Agent Resolution Logic

The AI Risk Agent CRE workflow:
- **Trigger**: Cron (daily check near expiration)
- **Data Sources**:
  - DeFiLlama API (TVL history)
  - Confidential HTTP (exploit databases)
  - On-chain events (via CRE)
- **Decision Process**:
  1. Query protocol TVL history over market duration
  2. Check for reported exploits >$1M
  3. Verify with multiple sources
  4. Calculate confidence score
  5. If confidence >90%, call `resolve(outcome)`

### Manual Resolution (Owner)

In case of CRE workflow failure:
```bash
# Owner can resolve manually
cast send $RISK_MARKET_ADDRESS \
  "resolve(bool)" true \
  --private-key $PRIVATE_KEY \
  --rpc-url $SEPOLIA_RPC_URL
```

## Settlement (TODO - Post-Hackathon)

Current implementation emits resolution event but defers settlement logic.

**Planned Settlement**:
- **If `lossEvent == true`**: RISK token holders receive proportional payout from USDC pool
- **If `lossEvent == false`**: USDC depositors can reclaim their funds, RISK tokens become worthless
- **Shield Mode**: Active shields trigger automatic payouts from InsurancePool

## Frontend Display

The dashboard now shows:
- **Active Market**: Duration (30 days), Resolution method (CRE Workflow), Status (Autonomous)
- **Resolved Market**: Trading closed indicator, final outcome (when settlement implemented)

## Security Considerations

1. **Dual Authorization**: Prevents single point of failure
2. **Idempotent**: Cannot be resolved twice
3. **Pausable Trading**: Resolution immediately halts all trades
4. **Event Logging**: All resolutions logged on-chain for transparency

## Testing

Resolution is tested in `RiskMarket.t.sol`:
- `test_Resolve_ByOwner()` - Owner can resolve
- `test_Resolve_ByCREWorkflow()` - CRE workflow can resolve
- `test_Resolve_CannotResolveTwice()` - Prevents double resolution
- `test_Resolve_EmitsEvent()` - Emits correct event
- `test_Resolve_RejectsUnauthorized()` - Only authorized callers

## Deployment Status

**Sepolia**: All contracts deployed with resolution enabled
- RiskMarket: [`0x7adcC628e5B2167e9Ad7a78249007b21f03853eD`](https://sepolia.etherscan.io/address/0x7adcc628e5b2167e9ad7a78249007b21f03853ed)
- CRE Workflow: Configured in deployment
- Owner: `0xc31F9d7c714CA694224e041Ec55C9B2adb892b0D`

## Demo Scenario

For hackathon demonstration:
1. Show active market on dashboard with resolution details
2. Explain CRE workflow autonomous monitoring
3. If needed, demonstrate manual owner resolution
4. Show resolved state and trading halt

**Note**: Full settlement/payout logic is intentionally deferred for post-hackathon development. The core resolution mechanism showcases CRE autonomous capabilities.
