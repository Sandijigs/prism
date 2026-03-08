import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Contract addresses from environment
const RISK_MARKET_ADDRESS = process.env.NEXT_PUBLIC_RISK_MARKET_ADDRESS || '';
const SHIELD_VAULT_ADDRESS = process.env.NEXT_PUBLIC_SHIELD_VAULT_ADDRESS || '';
const INSURANCE_POOL_ADDRESS = process.env.NEXT_PUBLIC_INSURANCE_POOL_ADDRESS || '';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || '';

// ABI fragments (only the functions we need)
const RISK_MARKET_ABI = [
  'function getCurrentZone() view returns (uint8)',
  'function getCurrentRiskPrice() view returns (uint256)',
  'function riskPool() view returns (uint256)',
  'function usdcPool() view returns (uint256)',
  'function resolved() view returns (bool)',
];

const SHIELD_VAULT_ABI = [
  'function deposits(address) view returns (uint256)',
  'function shieldActive(address) view returns (bool)',
  'function protectionLevel(address) view returns (uint256)',
  'function premiumPaid(address) view returns (uint256)',
  'function protectedProtocol(address) view returns (address)',
  'function securedAmount(address) view returns (uint256)',
  'function calculatePremium(uint256) view returns (uint256)',
];

const INSURANCE_POOL_ABI = [
  'function totalPoolBalance() view returns (uint256)',
  'function totalPremiumsCollected() view returns (uint256)',
  'function totalClaimsPaid() view returns (uint256)',
  'function currentUtilizationBps() view returns (uint256)',
  'function paused() view returns (bool)',
];

// Helper to get provider
function getProvider() {
  if (typeof window !== 'undefined' && RPC_URL) {
    return new ethers.providers.StaticJsonRpcProvider(RPC_URL, {
      name: 'tenderly-vtn',
      chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 73571,
    });
  }
  return null;
}

// Zone names mapping
const ZONE_NAMES = ['Green', 'Yellow', 'Orange', 'Red'] as const;

export interface RiskMarketData {
  price: number;
  zone: typeof ZONE_NAMES[number];
  totalRisk: string;
  totalUsdc: string;
  isResolved: boolean;
  loading: boolean;
  error: string | null;
}

export function useRiskMarket(refreshTrigger = 0): RiskMarketData {
  const [data, setData] = useState<RiskMarketData>({
    price: 3.2,
    zone: 'Green',
    totalRisk: '1000000',
    totalUsdc: '5000000',
    isResolved: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      const provider = getProvider();

      if (!provider || !RISK_MARKET_ADDRESS) {
        // Use mock data
        if (isMounted) {
          setData(prev => ({ ...prev, loading: false }));
        }
        return;
      }

      try {
        const contract = new ethers.Contract(RISK_MARKET_ADDRESS, RISK_MARKET_ABI, provider);

        const [zone, price, riskReserve, usdcReserve, isResolved] = await Promise.all([
          contract.getCurrentZone(),
          contract.getCurrentRiskPrice(),
          contract.riskPool(),
          contract.usdcPool(),
          contract.resolved(),
        ]);

        if (isMounted) {
          setData({
            price: Number(price), // getCurrentRiskPrice returns 0-100 integer (percentage)
            zone: ZONE_NAMES[zone] || 'Green',
            totalRisk: ethers.utils.formatUnits(riskReserve, 18),
            totalUsdc: ethers.utils.formatUnits(usdcReserve, 18),
            isResolved,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        console.error('Error fetching risk market data:', err);
        if (isMounted) {
          setData(prev => ({ ...prev, loading: false, error: 'Failed to load data' }));
        }
      }
    }

    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [refreshTrigger]);

  return data;
}

export interface ShieldVaultData {
  deposit: string;
  shieldActive: boolean;
  protectionLevel: number;
  premiumPaid: string;
  protectedProtocol: string;
  securedAmount: string;
  loading: boolean;
  error: string | null;
}

export function useShieldVault(address?: string, refreshTrigger = 0): ShieldVaultData {
  const [data, setData] = useState<ShieldVaultData>({
    deposit: '0',
    shieldActive: false,
    protectionLevel: 0,
    premiumPaid: '0',
    protectedProtocol: '',
    securedAmount: '0',
    loading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      const provider = getProvider();

      if (!provider || !SHIELD_VAULT_ADDRESS || !address) {
        if (isMounted) {
          setData(prev => ({ ...prev, loading: false }));
        }
        return;
      }

      try {
        const contract = new ethers.Contract(SHIELD_VAULT_ADDRESS, SHIELD_VAULT_ABI, provider);

        const [deposit, active, level, premium, protocol, secured] = await Promise.all([
          contract.deposits(address),
          contract.shieldActive(address),
          contract.protectionLevel(address),
          contract.premiumPaid(address),
          contract.protectedProtocol(address),
          contract.securedAmount(address),
        ]);

        if (isMounted) {
          setData({
            deposit: ethers.utils.formatUnits(deposit, 6),
            shieldActive: active,
            protectionLevel: Number(level),
            premiumPaid: ethers.utils.formatUnits(premium, 6),
            protectedProtocol: protocol,
            securedAmount: ethers.utils.formatUnits(secured, 6),
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        console.error('Error fetching shield vault data:', err);
        if (isMounted) {
          setData(prev => ({ ...prev, loading: false, error: 'Failed to load data' }));
        }
      }
    }

    fetchData();

    const interval = setInterval(fetchData, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [address, refreshTrigger]);

  return data;
}

export interface InsurancePoolData {
  totalPoolBalance: string;
  totalPremiumsCollected: string;
  totalClaimsPaid: string;
  utilization: number;
  isPaused: boolean;
  loading: boolean;
  error: string | null;
}

export function useInsurancePool(): InsurancePoolData {
  const [data, setData] = useState<InsurancePoolData>({
    totalPoolBalance: '0',
    totalPremiumsCollected: '0',
    totalClaimsPaid: '0',
    utilization: 0,
    isPaused: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      const provider = getProvider();

      if (!provider || !INSURANCE_POOL_ADDRESS) {
        if (isMounted) {
          setData(prev => ({ ...prev, loading: false }));
        }
        return;
      }

      try {
        const contract = new ethers.Contract(INSURANCE_POOL_ADDRESS, INSURANCE_POOL_ABI, provider);

        const [poolBalance, premiums, claims, utilization, paused] = await Promise.all([
          contract.totalPoolBalance(),
          contract.totalPremiumsCollected(),
          contract.totalClaimsPaid(),
          contract.currentUtilizationBps(),
          contract.paused(),
        ]);

        if (isMounted) {
          setData({
            totalPoolBalance: ethers.utils.formatUnits(poolBalance, 6),
            totalPremiumsCollected: ethers.utils.formatUnits(premiums, 6),
            totalClaimsPaid: ethers.utils.formatUnits(claims, 6),
            utilization: utilization.toNumber(),
            isPaused: paused,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        console.error('Error fetching insurance pool data:', err);
        if (isMounted) {
          setData(prev => ({ ...prev, loading: false, error: 'Failed to load data' }));
        }
      }
    }

    fetchData();

    const interval = setInterval(fetchData, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return data;
}
