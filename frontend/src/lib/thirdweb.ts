import { createThirdwebClient } from 'thirdweb';
import { defineChain } from 'thirdweb/chains';

// Create thirdweb client
export const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || 'demo',
});

// Chain configuration — Tenderly VTN (chain ID 73571)
// Full metadata provided to avoid thirdweb API calls to api.thirdweb.com/v1/chains/73571
export const chain = defineChain({
  id: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '73571'),
  name: 'PRISM Protocol VTN',
  rpc: process.env.NEXT_PUBLIC_RPC_URL || 'https://virtual.mainnet.eu.rpc.tenderly.co/8d35233f-67b8-4b58-b7e3-4444a4dcf4a3',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  testnet: true,
});

// Contract addresses (EIP-55 checksummed)
// .trim() strips any trailing whitespace/newlines from Vercel env vars
export const CONTRACTS = {
  riskMarket: (process.env.NEXT_PUBLIC_RISK_MARKET_ADDRESS || '0x7adcC628e5B2167e9Ad7a78249007b21f03853eD').trim(),
  shieldVault: (process.env.NEXT_PUBLIC_SHIELD_VAULT_ADDRESS || '0x76146B7f5bD0b83CB5c5DA0C0416A48dA40A8DbC').trim(),
  insurancePool: (process.env.NEXT_PUBLIC_INSURANCE_POOL_ADDRESS || '0x3F3F9256Fed14D07BFb524b93DDb1CA1dc56f335').trim(),
  worldIDGate: (process.env.NEXT_PUBLIC_WORLD_ID_GATE_ADDRESS || '0x3Db12a421cDeAe0EE70db946Bc3d8e00Cc7BC4D6').trim(),
  prismToken: (process.env.NEXT_PUBLIC_PRISM_TOKEN_ADDRESS || '0x659De2D8751548Ba5D1f6199e80796b772b57cC4').trim(),
  mockUSDC: (process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS || '0x4ac5C5d069Abb7023A0306Ad3058e16ACE44610B').trim(),
} as const;

// Explorer URLs
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://sepolia.etherscan.io';
export const TENDERLY_EXPLORER_URL = process.env.NEXT_PUBLIC_TENDERLY_EXPLORER_URL || '';
