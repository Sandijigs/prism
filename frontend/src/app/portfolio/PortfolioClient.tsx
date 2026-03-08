'use client';

import { useActiveAccount, useReadContract } from 'thirdweb/react';
import { useRiskMarket } from '@/hooks/useContracts';
import { useIsVerified, useShieldVaultDeposit, useShieldVaultActive, getRiskMarketContract } from '@/hooks/usePRISMContracts';
import Link from 'next/link';
import WorldIDVerifyButton from '@/components/WorldIDVerifyButton';

function StatCard({ title, value, subtitle, icon, color = 'blue' }: {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  color?: 'blue' | 'green' | 'yellow' | 'purple'
}) {
  const colorClasses = {
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30',
    green: 'from-green-500/20 to-green-600/20 border-green-500/30',
    yellow: 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/30',
    purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/30',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-xl p-6 border`}>
      <div className="flex items-start justify-between mb-4">
        <div className="text-gray-400 text-sm font-medium">{title}</div>
        <div className="text-3xl">{icon}</div>
      </div>
      <div className="text-4xl font-bold mb-2">{value}</div>
      <div className="text-sm text-gray-400">{subtitle}</div>
    </div>
  );
}

function ConnectWalletPrompt() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-4">👛</div>
        <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
        <p className="text-gray-400 mb-6">
          Connect your wallet to view your portfolio, positions, and Shield status.
        </p>
        <p className="text-sm text-gray-500">
          Click "Connect Wallet" in the top right corner to get started.
        </p>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const account = useActiveAccount();
  const riskMarket = useRiskMarket();
  const { data: isVerified } = useIsVerified(account?.address);
  const { data: shieldDeposit } = useShieldVaultDeposit(account?.address);
  const { data: shieldActive } = useShieldVaultActive(account?.address);

  // Read RISK token balance from RiskMarket contract (same as market page)
  const { data: riskBalanceRaw } = useReadContract({
    contract: getRiskMarketContract(),
    method: 'function riskBalances(address) view returns (uint256)',
    params: [account?.address || '0x0000000000000000000000000000000000000000'],
  });

  if (!account) {
    return <ConnectWalletPrompt />;
  }

  // Live data from chain
  const riskBalance = riskBalanceRaw ? (Number(riskBalanceRaw) / 1e18) : 0;
  const riskBalanceFormatted = riskBalance.toFixed(2);
  const usdcDeposited = shieldDeposit ? (Number(shieldDeposit) / 1e6).toFixed(2) : '0.00';

  // RISK position value: riskBalance * (price/100) gives value in USDC terms
  const currentRiskPrice = riskMarket.price;
  const riskPositionValue = riskBalance * (currentRiskPrice / 100);
  // Total portfolio = RISK position value + shield vault deposit
  const totalPortfolioValue = riskPositionValue + parseFloat(usdcDeposited);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Portfolio</h1>
          <p className="text-gray-400">
            Connected: {account.address.slice(0, 6)}...{account.address.slice(-4)}
            {isVerified && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400 border border-green-700/50">
                ✓ World ID Verified
              </span>
            )}
          </p>
        </div>
        <Link
          href="/market"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
        >
          Trade Market
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="RISK Tokens"
          value={riskBalanceFormatted}
          subtitle={`@ ${currentRiskPrice.toFixed(2)}% per token`}
          icon="📈"
          color="blue"
        />
        <StatCard
          title="RISK Position Value"
          value={`$${riskPositionValue.toFixed(2)}`}
          subtitle={`${riskBalanceFormatted} RISK × ${currentRiskPrice.toFixed(2)}%`}
          icon="💵"
          color="green"
        />
        <StatCard
          title="Shield Deposit"
          value={`$${usdcDeposited}`}
          subtitle={shieldActive ? 'Protected in ShieldVault' : 'Deposited in ShieldVault'}
          icon="🛡️"
          color={parseFloat(usdcDeposited) > 0 ? 'green' : 'yellow'}
        />
        <StatCard
          title="Shield Status"
          value={shieldActive ? 'Active' : 'Inactive'}
          subtitle={shieldActive ? `$${usdcDeposited} protected` : 'Not activated'}
          icon="🛡️"
          color={shieldActive ? 'green' : 'purple'}
        />
      </div>

      {/* Positions Table */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
        <h2 className="text-xl font-semibold mb-6">Your Positions</h2>

        {riskBalance === 0 && !shieldActive && parseFloat(usdcDeposited) === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📊</div>
            <h3 className="text-lg font-medium mb-2">No Active Positions</h3>
            <p className="text-gray-400 mb-6">
              Start trading RISK tokens or activate Shield Mode to protect your positions.
            </p>
            <div className="flex items-center justify-center space-x-4">
              <Link
                href="/market"
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
              >
                Trade RISK
              </Link>
              <Link
                href="/shield"
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
              >
                Activate Shield
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {riskBalance > 0 && (
              <div className="flex items-center justify-between py-4 px-6 bg-gray-900/50 rounded-lg border border-gray-700">
                <div>
                  <div className="text-lg font-semibold">RISK Tokens</div>
                  <div className="text-sm text-gray-400">Risk Market Position</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">{riskBalanceFormatted} RISK</div>
                  <div className="text-sm text-gray-400">Value: ${riskPositionValue.toFixed(2)} USDC</div>
                </div>
              </div>
            )}

            {shieldActive && (
              <div className="flex items-center justify-between py-4 px-6 bg-green-900/20 rounded-lg border border-green-700/50">
                <div>
                  <div className="text-lg font-semibold flex items-center space-x-2">
                    <span>🛡️</span>
                    <span>Shield Mode</span>
                    <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">ACTIVE</span>
                  </div>
                  <div className="text-sm text-gray-400">Automated Protection Enabled</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-green-400">${usdcDeposited}</div>
                  <div className="text-sm text-gray-400">Protected Amount</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Account Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-4">Account Status</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">World ID Verification</span>
              <span className={`font-medium ${isVerified ? 'text-green-400' : 'text-gray-400'}`}>
                {isVerified ? '✓ Verified' : '✗ Not Verified'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">Trading Weight</span>
              <span className="font-medium text-gray-300">
                {isVerified ? '5x (Verified)' : '1x (Unverified)'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">Shield Status</span>
              <span className={`font-medium ${shieldActive ? 'text-green-400' : 'text-gray-400'}`}>
                {shieldActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          {!isVerified && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-sm text-gray-400 mb-3">
                Verify with World ID to get 5x better trading rates!
              </p>
              <WorldIDVerifyButton address={account.address} />
            </div>
          )}
        </div>

        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-4">Risk Metrics</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">Current Zone</span>
              <span className={`font-medium px-2 py-0.5 rounded text-sm ${
                riskMarket.zone === 'Green' ? 'bg-green-900/30 text-green-400' :
                riskMarket.zone === 'Yellow' ? 'bg-yellow-900/30 text-yellow-400' :
                riskMarket.zone === 'Orange' ? 'bg-orange-900/30 text-orange-400' :
                'bg-red-900/30 text-red-400'
              }`}>
                {riskMarket.zone}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">Market Price</span>
              <span className="font-medium text-gray-300">{currentRiskPrice.toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">Market Status</span>
              <span className={`font-medium ${riskMarket.isResolved ? 'text-gray-400' : 'text-green-400'}`}>
                {riskMarket.isResolved ? 'Resolved' : 'Active'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
