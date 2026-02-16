import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Contract addresses from environment
const RISK_MARKET_ADDRESS = process.env.NEXT_PUBLIC_RISK_MARKET_ADDRESS || '';
const SHIELD_VAULT_ADDRESS = process.env.NEXT_PUBLIC_SHIELD_VAULT_ADDRESS || '';
const INSURANCE_POOL_ADDRESS = process.env.NEXT_PUBLIC_INSURANCE_POOL_ADDRESS || '';
const RPC_URL = process.env.NEXT_PUBLIC_TENDERLY_RPC_URL || '';

// ABI fragments (only the functions we need)
const RISK_MARKET_ABI = [
  'function getCurrentZone() view returns (uint8)',
  'function getCurrentRiskPrice() view returns (uint256)',
  'function totalRiskTokens() view returns (uint256)',
  'function totalUsdcLiquidity() view returns (uint256)',
  'function isResolved() view returns (bool)',
];

const SHIELD_VAULT_ABI = [
  'function deposits(address) view returns (uint256)',
  'function shieldActivated(address) view returns (bool)',
  'function protectionLevel() view returns (uint8)',
];

const INSURANCE_POOL_ABI = [
  'function totalLiquidity() view returns (uint256)',
  'function totalClaims() view returns (uint256)',
  'function currentUtilizationBps() view returns (uint256)',
  'function isPaused() view returns (bool)',
];

// Helper to get provider
function getProvider() {
  if (typeof window !== 'undefined' && RPC_URL) {
    return new ethers.providers.JsonRpcProvider(RPC_URL);
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

export function useRiskMarket(): RiskMarketData {
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

        const [zone, price, totalRisk, totalUsdc, isResolved] = await Promise.all([
          contract.getCurrentZone(),
          contract.getCurrentRiskPrice(),
          contract.totalRiskTokens(),
          contract.totalUsdcLiquidity(),
          contract.isResolved(),
        ]);

        if (isMounted) {
          setData({
            price: Number(ethers.utils.formatUnits(price, 4)) / 100, // Price is in basis points
            zone: ZONE_NAMES[zone] || 'Green',
            totalRisk: ethers.utils.formatUnits(totalRisk, 18),
            totalUsdc: ethers.utils.formatUnits(totalUsdc, 6),
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
  }, []);

  return data;
}

export interface ShieldVaultData {
  deposit: string;
  shieldActive: boolean;
  protectionLevel: number;
  loading: boolean;
  error: string | null;
}

export function useShieldVault(address?: string): ShieldVaultData {
  const [data, setData] = useState<ShieldVaultData>({
    deposit: '0',
    shieldActive: false,
    protectionLevel: 0,
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

        const [deposit, shieldActive, protectionLevel] = await Promise.all([
          contract.deposits(address),
          contract.shieldActivated(address),
          contract.protectionLevel(),
        ]);

        if (isMounted) {
          setData({
            deposit: ethers.utils.formatUnits(deposit, 6),
            shieldActive,
            protectionLevel,
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
  }, [address]);

  return data;
}

export interface InsurancePoolData {
  totalLiquidity: string;
  totalClaims: string;
  utilization: number;
  isPaused: boolean;
  loading: boolean;
  error: string | null;
}

export function useInsurancePool(): InsurancePoolData {
  const [data, setData] = useState<InsurancePoolData>({
    totalLiquidity: '5000000',
    totalClaims: '250000',
    utilization: 500, // 5% in basis points
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

        const [totalLiquidity, totalClaims, utilization, isPaused] = await Promise.all([
          contract.totalLiquidity(),
          contract.totalClaims(),
          contract.currentUtilizationBps(),
          contract.isPaused(),
        ]);

        if (isMounted) {
          setData({
            totalLiquidity: ethers.utils.formatUnits(totalLiquidity, 6),
            totalClaims: ethers.utils.formatUnits(totalClaims, 6),
            utilization: utilization.toNumber(),
            isPaused,
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
