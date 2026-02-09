# Tenderly Virtual TestNet — PRISM Protocol

## Explorer URL (Hackathon Submission)

https://dashboard.tenderly.co/sasha_bey/project/testnet/8e50aefd-ebcd-44a4-a626-1055c2dc308e

## Network Details

| Property         | Value                              |
|------------------|------------------------------------|
| Name             | PRISM Protocol VTN                 |
| Chain ID         | 73571                              |
| Forked from      | Ethereum Mainnet (latest)          |
| VTN ID           | 8e50aefd-ebcd-44a4-a626-1055c2dc308e |

## RPC Endpoints

| Type             | URL |
|------------------|-----|
| Admin RPC        | https://virtual.mainnet.eu.rpc.tenderly.co/34bf7395-c4b7-4718-ac0a-b813e49ee8da |
| Public RPC       | https://virtual.mainnet.eu.rpc.tenderly.co/dad1d291-6bcd-4bf1-b99d-609129d7057a |

## MetaMask Configuration

| Field              | Value                              |
|--------------------|-------------------------------------|
| Network Name       | PRISM Protocol VTN                 |
| RPC URL            | (Public RPC above)                 |
| Chain ID           | 73571                              |
| Currency Symbol    | ETH                                |
| Block Explorer URL | (Explorer URL above)               |

## Funded Wallets

| Address                                    | Balance  |
|--------------------------------------------|----------|
| 0xeEA4353FE0641fA7730e1c9Bc7cC0f969ECd5914 | 1,000 ETH |
| 0xc31F9d7c714CA694224e041Ec55C9B2adb892b0D | 1,000 ETH |

## Deployed Contracts (Full Protocol)

| Contract      | Address                                    |
|---------------|---------------------------------------------|
| MockUSDC      | 0x4ac5C5d069Abb7023A0306Ad3058e16ACE44610B |
| RiskMarket    | 0x7adcC628e5B2167e9Ad7a78249007b21f03853eD |
| InsurancePool | 0x3F3F9256Fed14D07BFb524b93DDb1CA1dc56f335 |
| ShieldVault   | 0x76146B7f5bD0b83CB5c5DA0C0416A48dA40A8DbC |
| WorldIDGate   | 0x3Db12a421cDeAe0EE70db946Bc3d8e00Cc7BC4D6 |
| PRISMToken    | 0x659De2D8751548Ba5D1f6199e80796b772b57cC4 |

Deployed via `forge script script/Deploy.s.sol:DeployPRISM`.
All cross-contract references wired. WorldIDGate in mock mode.
InsurancePool seeded with 500K USDC. RiskMarket approved for deployer trading.

## Faucet (Unlimited)

Fund any wallet via the Admin RPC:

```bash
curl -X POST $TENDERLY_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tenderly_setBalance","params":["<ADDRESS>","0x3635C9ADC5DEA00000"],"id":1}'
```
