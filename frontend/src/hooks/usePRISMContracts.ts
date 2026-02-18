import { getContract, prepareContractCall, readContract } from 'thirdweb';
import { useReadContract, useSendTransaction } from 'thirdweb/react';
import { client, chain, CONTRACTS } from '../lib/thirdweb';

// ── Contract Instances ──────────────────────────────────────────────────────

export const getRiskMarketContract = () => getContract({
  client,
  chain,
  address: CONTRACTS.riskMarket,
});

export const getShieldVaultContract = () => getContract({
  client,
  chain,
  address: CONTRACTS.shieldVault,
});

export const getInsurancePoolContract = () => getContract({
  client,
  chain,
  address: CONTRACTS.insurancePool,
});

export const getWorldIDGateContract = () => getContract({
  client,
  chain,
  address: CONTRACTS.worldIDGate,
});

export const getMockUSDCContract = () => getContract({
  client,
  chain,
  address: CONTRACTS.mockUSDC,
});

// ── Risk Market Hooks ───────────────────────────────────────────────────────

export function useRiskMarketPrice() {
  const contract = getRiskMarketContract();
  return useReadContract({
    contract,
    method: 'function getCurrentRiskPrice() view returns (uint256)',
    params: [],
  });
}

export function useRiskMarketZone() {
  const contract = getRiskMarketContract();
  return useReadContract({
    contract,
    method: 'function getCurrentZone() view returns (uint8)',
    params: [],
  });
}

export function useRiskMarketInfo() {
  const contract = getRiskMarketContract();
  return useReadContract({
    contract,
    method: 'function getMarketInfo() view returns (tuple(uint256,uint8,uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256,uint256,uint256))',
    params: [],
  });
}

export function useBuyRisk() {
  const contract = getRiskMarketContract();
  const { mutate: sendTransaction } = useSendTransaction();

  const buyRisk = async (usdcAmount: bigint) => {
    const transaction = prepareContractCall({
      contract,
      method: 'function buyRisk(uint256 usdcAmount) returns (uint256)',
      params: [usdcAmount],
    });
    return sendTransaction(transaction);
  };

  return { buyRisk };
}

export function useSellRisk() {
  const contract = getRiskMarketContract();
  const { mutate: sendTransaction } = useSendTransaction();

  const sellRisk = async (riskAmount: bigint) => {
    const transaction = prepareContractCall({
      contract,
      method: 'function sellRisk(uint256 riskAmount) returns (uint256)',
      params: [riskAmount],
    });
    return sendTransaction(transaction);
  };

  return { sellRisk };
}

// ── Shield Vault Hooks ──────────────────────────────────────────────────────

export function useShieldVaultDeposit(address?: string) {
  const contract = getShieldVaultContract();
  return useReadContract({
    contract,
    method: 'function deposits(address) view returns (uint256)',
    params: [address || '0x0000000000000000000000000000000000000000'],
  });
}

export function useShieldVaultActive(address?: string) {
  const contract = getShieldVaultContract();
  return useReadContract({
    contract,
    method: 'function shieldActive(address) view returns (bool)',
    params: [address || '0x0000000000000000000000000000000000000000'],
  });
}

export function useActivateShield() {
  const contract = getShieldVaultContract();
  const { mutate: sendTransaction } = useSendTransaction();

  const activateShield = async (usdcAmount: bigint) => {
    const transaction = prepareContractCall({
      contract,
      method: 'function depositAndActivate(uint256 usdcAmount)',
      params: [usdcAmount],
      // In production: enable gasless transactions via thirdweb Engine
      // gas: 'sponsored',
    });
    return sendTransaction(transaction);
  };

  return { activateShield };
}

// ── Insurance Pool Hooks ────────────────────────────────────────────────────

export function useInsurancePoolBalance() {
  const contract = getInsurancePoolContract();
  return useReadContract({
    contract,
    method: 'function totalPoolBalance() view returns (uint256)',
    params: [],
  });
}

export function useInsurancePoolUtilization() {
  const contract = getInsurancePoolContract();
  return useReadContract({
    contract,
    method: 'function currentUtilizationBps() view returns (uint256)',
    params: [],
  });
}

// ── World ID Gate Hooks ─────────────────────────────────────────────────────

export function useIsVerified(address?: string) {
  const contract = getWorldIDGateContract();
  return useReadContract({
    contract,
    method: 'function isVerified(address) view returns (bool)',
    params: [address || '0x0000000000000000000000000000000000000000'],
  });
}

export function useTotalVerified() {
  const contract = getWorldIDGateContract();
  return useReadContract({
    contract,
    method: 'function totalVerified() view returns (uint256)',
    params: [],
  });
}

// ── Mock USDC Hooks ─────────────────────────────────────────────────────────

export function useApproveUSDC() {
  const contract = getMockUSDCContract();
  const { mutate: sendTransaction } = useSendTransaction();

  const approve = async (spender: string, amount: bigint) => {
    const transaction = prepareContractCall({
      contract,
      method: 'function approve(address spender, uint256 amount) returns (bool)',
      params: [spender, amount],
    });
    return sendTransaction(transaction);
  };

  return { approve };
}
