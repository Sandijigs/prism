# Tenderly Virtual TestNet — PRISM Protocol

## Explorer URL (Hackathon Submission)

https://dashboard.tenderly.co/sasha_bey/project/testnet/91cd6067-7154-43a7-8b3d-314ec3f799f3

## Network Details

| Property         | Value                              |
|------------------|------------------------------------|
| Name             | PRISM Protocol VTN                 |
| Chain ID         | 73571                              |
| Forked from      | Ethereum Mainnet @ block 21408839  |
| VTN ID           | 91cd6067-7154-43a7-8b3d-314ec3f799f3 |

## RPC Endpoints

| Type             | URL |
|------------------|-----|
| Admin RPC        | https://virtual.mainnet.eu.rpc.tenderly.co/433ed460-a461-4280-bf41-241fe6c6838b |
| Public RPC       | https://virtual.mainnet.eu.rpc.tenderly.co/9ecfd80e-d72d-478b-b72f-a9b7997bfd84 |

## MetaMask Configuration

| Field              | Value                              |
|--------------------|------------------------------------|
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

## Test Deployments

| Contract   | Address                                    |
|------------|--------------------------------------------|
| RiskMarket | 0x4ac5C5d069Abb7023A0306Ad3058e16ACE44610B |

## Faucet (Unlimited)

Fund any wallet via the Admin RPC:

```bash
curl -X POST $TENDERLY_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tenderly_setBalance","params":["<ADDRESS>","0x3635C9ADC5DEA00000"],"id":1}'
```
