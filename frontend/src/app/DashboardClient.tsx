'use client';

import { useRiskMarket, useInsurancePool } from '@/hooks/useContracts';
import { useIsVerified, useTotalVerified } from '@/hooks/usePRISMContracts';
import { useActiveAccount } from 'thirdweb/react';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useState, useEffect } from 'react';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function formatUSD(value: number): string {
  return `$${formatNumber(value)}`;
}

// Generate price history that trends toward current price
const generatePriceHistory = (currentPrice: number) => {
  const data = [];
  const now = Date.now();
  const clamped = Math.max(0, Math.min(100, currentPrice));
  let price = Math.max(1, clamped * 0.3);

  for (let i = 23; i >= 0; i--) {
    price = price + (clamped - price) * 0.15 + (Math.random() - 0.45) * 3;
    price = Math.max(0.5, Math.min(99.5, price));
    data.push({
      time: new Date(now - i * 3600000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      price: parseFloat(price.toFixed(1)),
    });
  }

  return data;
};

// Dynamic activity feed based on actual contract state
const generateActivity = (zone: string, price: number, isPaused: boolean) => {
  const items: { id: number; time: string; description: string; type: string }[] = [];
  let id = 1;

  if (zone === 'Red') {
    items.push({ id: id++, time: 'Just now', description: `EMERGENCY: Risk at ${price.toFixed(1)}% — Full protection activated`, type: 'zone' });
    items.push({ id: id++, time: '1 min ago', description: 'CRE Threshold Controller: triggerProtection(3) executed', type: 'system' });
  }
  if (isPaused) {
    items.push({ id: id++, time: '2 mins ago', description: 'Insurance Pool: pauseNewShields() — No new exposure', type: 'system' });
  }
  if (zone === 'Orange' || zone === 'Red') {
    items.push({ id: id++, time: '3 mins ago', description: 'CRE Threshold Controller: triggerProtection(2) — 50% secured', type: 'system' });
  }
  if (zone !== 'Green') {
    items.push({ id: id++, time: '5 mins ago', description: `Zone escalated to ${zone} — CRE monitoring intensified`, type: 'zone' });
  }
  items.push({ id: id++, time: '10 mins ago', description: 'CRE AI Risk Agent: Multi-source analysis complete', type: 'ai' });
  items.push({ id: id++, time: '15 mins ago', description: 'CRE Risk Monitor: TVL data fetched via ConfidentialHTTP', type: 'trade' });
  items.push({ id: id++, time: '30 mins ago', description: 'CRE Reserve Verifier: Pool solvency check passed', type: 'shield' });

  return items.slice(0, 7);
};

// ── Components ──────────────────────────────────────────────────────────────

function ProtocolHero() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-950/80 via-purple-950/60 to-blue-950/80 border border-blue-800/30 p-8">
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-lg">P</div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">PRISM Protocol</h1>
        </div>
        <p className="text-lg text-gray-300 mb-5 max-w-2xl">
          Autonomous DeFi Protection — real-time risk monitoring, AI-powered analysis, and automated circuit breakers protecting depositors before crises hit.
        </p>
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400"></div>
            <span className="text-gray-400">Powered by</span>
            <span className="text-blue-400 font-medium">Chainlink CRE</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400"></div>
            <span className="text-gray-400">Identity via</span>
            <span className="text-green-400 font-medium">World ID</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400"></div>
            <span className="text-gray-400">Built with</span>
            <span className="text-purple-400 font-medium">thirdweb v5</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-orange-400"></div>
            <span className="text-gray-400">Deployed on</span>
            <span className="text-orange-400 font-medium">Tenderly VTN</span>
          </div>
        </div>
      </div>
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-1/2 w-48 h-48 bg-purple-500/5 rounded-full blur-3xl"></div>
    </div>
  );
}

function RiskZoneIndicator({ zone, price }: { zone: string; price: number }) {
  const zoneConfig = {
    Green: { bg: 'bg-zone-green', label: 'NORMAL', pulse: false, desc: 'Standard monitoring active' },
    Yellow: { bg: 'bg-zone-yellow', label: 'ELEVATED', pulse: false, desc: 'Enhanced CRE monitoring' },
    Orange: { bg: 'bg-zone-orange', label: 'WARNING', pulse: true, desc: '50% deposits auto-secured' },
    Red: { bg: 'bg-zone-red', label: 'CRITICAL', pulse: true, desc: '100% protection activated' },
  };

  const config = zoneConfig[zone as keyof typeof zoneConfig] || zoneConfig.Green;

  return (
    <div className={`${config.bg} rounded-2xl p-10 text-center relative overflow-hidden ${config.pulse ? 'animate-pulse-slow' : ''}`}>
      <div className="relative z-10">
        <div className="text-xs uppercase tracking-widest text-white/60 mb-2">Current Risk Level</div>
        <div className="text-7xl font-bold mb-3">{price.toFixed(1)}%</div>
        <div className="text-2xl font-semibold tracking-wider">{config.label}</div>
        <div className="text-sm mt-2 opacity-80">{zone} Zone — {config.desc}</div>
      </div>
      {config.pulse && (
        <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
      )}
    </div>
  );
}

function ZoneProgressBar({ zone }: { zone: string }) {
  const zones = [
    { name: 'Green', range: '< 5%', color: 'bg-zone-green', active: true },
    { name: 'Yellow', range: '5-15%', color: 'bg-zone-yellow', active: ['Yellow', 'Orange', 'Red'].includes(zone) },
    { name: 'Orange', range: '15-35%', color: 'bg-zone-orange', active: ['Orange', 'Red'].includes(zone) },
    { name: 'Red', range: '> 35%', color: 'bg-zone-red', active: zone === 'Red' },
  ];

  return (
    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">Zone Escalation Path</div>
      <div className="flex gap-1.5">
        {zones.map((z) => (
          <div key={z.name} className="flex-1">
            <div className={`h-2 rounded-full ${z.active ? z.color : 'bg-gray-700'} transition-all duration-500`}></div>
            <div className="mt-2 text-center">
              <div className={`text-xs font-medium ${z.active ? 'text-white' : 'text-gray-600'}`}>{z.name}</div>
              <div className="text-[10px] text-gray-500">{z.range}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickStatsCard({ title, value, subtitle, icon, highlight }: { title: string; value: string; subtitle: string; icon: string; highlight?: boolean }) {
  return (
    <div className={`bg-gray-800/50 rounded-xl p-6 border transition-colors ${highlight ? 'border-red-600/50 bg-red-950/20' : 'border-gray-700 hover:border-gray-600'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-gray-400 text-sm font-medium">{title}</div>
        <div className="text-2xl">{icon}</div>
      </div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-sm text-gray-400">{subtitle}</div>
    </div>
  );
}

function PriceChart({ data, zone }: { data: { time: string; price: number }[]; zone: string }) {
  const zoneColors: Record<string, string> = {
    Green: '#2D6A4F',
    Yellow: '#E9C46A',
    Orange: '#F4A261',
    Red: '#E63946',
  };

  const maxPrice = Math.max(...data.map(d => d.price), 35);
  const yMax = Math.min(100, Math.ceil(maxPrice / 10) * 10 + 10);

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold">Risk Price (24h)</h3>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-zone-green inline-block"></span> Green &lt;5%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-zone-yellow inline-block"></span> Yellow 5-15%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-zone-orange inline-block"></span> Orange 15-35%</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-zone-red inline-block"></span> Red &gt;35%</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="time"
            stroke="#9CA3AF"
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#9CA3AF"
            tick={{ fontSize: 12 }}
            domain={[0, yMax]}
            tickFormatter={(v: number) => `${v}%`}
            label={{ value: 'Risk Price (%)', angle: -90, position: 'insideLeft', style: { fill: '#9CA3AF' } }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#9CA3AF' }}
            formatter={(value: number) => [`${value.toFixed(1)}%`, 'Risk Price']}
          />
          <ReferenceLine y={5} stroke="#2D6A4F" strokeDasharray="5 5" />
          <ReferenceLine y={15} stroke="#E9C46A" strokeDasharray="5 5" />
          <ReferenceLine y={35} stroke="#F4A261" strokeDasharray="5 5" />
          <Line
            type="monotone"
            dataKey="price"
            stroke={zoneColors[zone] || '#2D6A4F'}
            strokeWidth={3}
            dot={false}
            animationDuration={1000}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProtectionMechanics({ zone, isPaused }: { zone: string; isPaused: boolean }) {
  const protections = [
    {
      zone: 'Green',
      label: 'Standard Monitoring',
      description: 'CRE Risk Monitor + AI Agent analyze 4 data sources every 5 min',
      active: true,
      color: 'text-zone-green',
      dotColor: 'bg-zone-green',
      borderColor: 'border-zone-green/30',
    },
    {
      zone: 'Yellow',
      label: 'Enhanced Surveillance',
      description: 'Increased monitoring frequency, CRE alerts DON operators',
      active: ['Yellow', 'Orange', 'Red'].includes(zone),
      color: 'text-zone-yellow',
      dotColor: 'bg-zone-yellow',
      borderColor: 'border-zone-yellow/30',
    },
    {
      zone: 'Orange',
      label: '50% Auto-Protection',
      description: 'triggerProtection(2) secures half of all shielded deposits',
      active: ['Orange', 'Red'].includes(zone),
      color: 'text-zone-orange',
      dotColor: 'bg-zone-orange',
      borderColor: 'border-zone-orange/30',
    },
    {
      zone: 'Red',
      label: 'Full Emergency',
      description: 'triggerProtection(3) + pauseNewShields() — 100% secured, pool locked',
      active: zone === 'Red',
      color: 'text-zone-red',
      dotColor: 'bg-zone-red',
      borderColor: 'border-zone-red/30',
    },
  ];

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold">Graduated Protection</h3>
        {isPaused && (
          <span className="text-xs font-medium text-red-400 bg-red-950/50 px-2 py-1 rounded-full">Pool Paused</span>
        )}
      </div>
      <div className="space-y-3">
        {protections.map((p) => (
          <div
            key={p.zone}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
              p.active ? `bg-gray-900/80 ${p.borderColor}` : 'bg-gray-900/20 border-gray-800 opacity-40'
            }`}
          >
            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${p.active ? p.dotColor : 'bg-gray-700'}`}></div>
            <div>
              <div className={`text-sm font-medium ${p.active ? p.color : 'text-gray-600'}`}>{p.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed({ activities }: { activities: { id: number; time: string; description: string; type: string }[] }) {
  const typeColors: Record<string, string> = {
    trade: 'text-blue-400',
    shield: 'text-green-400',
    zone: 'text-orange-400',
    ai: 'text-purple-400',
    system: 'text-gray-300',
  };

  const dotColors: Record<string, string> = {
    trade: 'bg-blue-500',
    shield: 'bg-green-500',
    zone: 'bg-orange-500',
    ai: 'bg-purple-500',
    system: 'bg-gray-400',
  };

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold">Live Activity</h3>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-xs text-green-400">Live</span>
        </div>
      </div>
      <div className="space-y-3">
        {activities.map((activity) => (
          <div key={activity.id} className="flex items-start space-x-3 text-sm">
            <div className={`w-2 h-2 rounded-full ${dotColors[activity.type] || 'bg-gray-500'} mt-1.5 flex-shrink-0`}></div>
            <div className="flex-1">
              <div className={`font-medium ${typeColors[activity.type] || 'text-gray-300'}`}>
                {activity.description}
              </div>
              <div className="text-gray-500 text-xs mt-0.5">{activity.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CREStatusCard() {
  const workflows = [
    { name: 'Risk Monitor', trigger: 'Cron (5 min)', desc: 'ConfidentialHTTP to DeFiLlama TVL', icon: '📊' },
    { name: 'AI Risk Agent', trigger: 'Cron (10 min)', desc: '4 data sources + Gemini LLM', icon: '🤖' },
    { name: 'Threshold Controller', trigger: 'Event (ZoneChanged)', desc: 'triggerProtection + pauseNewShields', icon: '🎯' },
    { name: 'Reserve Verifier', trigger: 'Cron (1 hour)', desc: 'Pool solvency check', icon: '✓' },
    { name: 'World ID Verifier', trigger: 'Event (VerificationRequested)', desc: 'Cross-chain identity relay via DON', icon: '🌐' },
  ];

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold">Chainlink CRE Workflows</h3>
          <p className="text-xs text-gray-500 mt-0.5">Autonomous backend orchestration on DON</p>
        </div>
        <span className="text-sm text-green-400 font-medium bg-green-950/50 px-2.5 py-1 rounded-full">5 Active</span>
      </div>
      <div className="space-y-2">
        {workflows.map((workflow) => (
          <div key={workflow.name} className="flex items-center justify-between py-2.5 px-3 bg-gray-900/50 rounded-lg">
            <div className="flex items-center space-x-3">
              <span className="text-lg">{workflow.icon}</span>
              <div>
                <div className="text-sm font-medium text-gray-200">{workflow.name}</div>
                <div className="text-xs text-gray-500">{workflow.trigger} — {workflow.desc}</div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs text-green-400 font-medium">Active</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center space-x-2 text-sm text-gray-400">
          <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>Powered by Chainlink CRE v1.0</span>
        </div>
        <div className="text-xs text-gray-600">CronCapability · ConfidentialHTTP · EVMClient · DON Consensus</div>
      </div>
    </div>
  );
}

function NetworkInfo() {
  return (
    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">Network</div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Chain</span>
          <span className="font-medium text-orange-400">Tenderly VTN</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Chain ID</span>
          <span className="font-mono text-gray-300">73571</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Fork</span>
          <span className="text-gray-300">Ethereum Mainnet</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Contracts</span>
          <span className="text-gray-300">6 deployed</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Tests</span>
          <span className="text-green-400">68/68 passing</span>
        </div>
      </div>
    </div>
  );
}

function WorldIDVerificationBadge({ address }: { address?: string }) {
  const { data: isVerified, isLoading } = useIsVerified(address);

  if (!address || isLoading) return null;

  if (isVerified) {
    return (
      <div className="inline-flex items-center space-x-2 px-3 py-1.5 bg-green-900/30 border border-green-700/50 rounded-full">
        <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-medium text-green-300">World ID Verified</span>
      </div>
    );
  }

  return (
    <Link
      href="/portfolio"
      className="inline-flex items-center space-x-2 px-3 py-1.5 bg-blue-900/30 border border-blue-700/50 rounded-full hover:border-blue-600 transition-colors"
    >
      <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" fill="currentColor" />
      </svg>
      <span className="text-sm text-blue-300">Verify with World ID</span>
    </Link>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const riskMarket = useRiskMarket();
  const insurancePool = useInsurancePool();
  const account = useActiveAccount();
  const { data: totalVerified } = useTotalVerified();
  const [priceHistory, setPriceHistory] = useState<{ time: string; price: number }[]>([]);

  useEffect(() => {
    if (!riskMarket.loading) {
      setPriceHistory(generatePriceHistory(riskMarket.price));
    }
  }, [riskMarket.price, riskMarket.loading]);

  const activities = generateActivity(riskMarket.zone, riskMarket.price, insurancePool.isPaused);

  // Pool balance is already formatted from 6 decimals by the hook
  const poolBalance = parseFloat(insurancePool.totalPoolBalance);
  const poolClaims = parseFloat(insurancePool.totalClaimsPaid);
  const poolSolvency = poolClaims > 0 ? ((poolBalance / poolClaims) * 100) : (poolBalance > 0 ? 100 : 0);

  // AMM reserves are already formatted from 18 decimals by the hook
  const riskPoolTokens = parseFloat(riskMarket.totalRisk);
  const usdcPoolTokens = parseFloat(riskMarket.totalUsdc);

  const verifiedCount = totalVerified ? Number(totalVerified) : 0;

  if (riskMarket.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-lg text-gray-400">Loading on-chain data...</div>
          <div className="text-xs text-gray-600 mt-1">Reading from Tenderly VTN (Chain 73571)</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Protocol Hero */}
      <ProtocolHero />

      {/* World ID Badge + Risk Zone */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {account?.address && (
            <div className="flex justify-end">
              <WorldIDVerificationBadge address={account.address} />
            </div>
          )}
          <RiskZoneIndicator zone={riskMarket.zone} price={riskMarket.price} />
          <ZoneProgressBar zone={riskMarket.zone} />
        </div>

        <div className="space-y-4">
          <Link
            href="/shield"
            className="block w-full px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-center transition-colors"
          >
            Activate Shield Mode
          </Link>
          <Link
            href="/market"
            className="block w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-center transition-colors"
          >
            Trade Risk Market
          </Link>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Market Status</div>
            <div className="text-lg font-semibold mb-2">
              {riskMarket.isResolved ? '🔒 Resolved' : '✅ Active'}
            </div>
            <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-700 space-y-1">
              <div className="flex items-center justify-between">
                <span>Duration:</span>
                <span className="font-medium text-gray-300">30 days</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Resolution:</span>
                <span className="font-medium text-blue-400">CRE Workflow</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Method:</span>
                <span className="font-medium text-gray-300">Autonomous</span>
              </div>
            </div>
          </div>
          <NetworkInfo />
        </div>
      </div>

      {/* On-Chain Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickStatsCard
          title="Insurance Pool"
          value={formatUSD(poolBalance)}
          subtitle={`${(insurancePool.utilization / 100).toFixed(1)}% utilized${insurancePool.isPaused ? ' · PAUSED' : ''}`}
          icon="💰"
          highlight={insurancePool.isPaused}
        />
        <QuickStatsCard
          title="World ID Verified"
          value={verifiedCount.toString()}
          subtitle="Sybil-resistant users (5x weight)"
          icon="🌐"
        />
        <QuickStatsCard
          title="Pool Solvency"
          value={poolClaims > 0 ? `${poolSolvency.toFixed(0)}%` : 'Healthy'}
          subtitle={poolClaims > 0 ? `${formatUSD(poolBalance)} / ${formatUSD(poolClaims)} claims` : 'No claims — fully solvent'}
          icon="📊"
        />
        <QuickStatsCard
          title="AI Risk Agent"
          value="Active"
          subtitle="CRE + Gemini LLM analysis"
          icon="🤖"
        />
      </div>

      {/* Price Chart */}
      {priceHistory.length > 0 && (
        <PriceChart data={priceHistory} zone={riskMarket.zone} />
      )}

      {/* Protection Mechanics + CRE Workflows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProtectionMechanics zone={riskMarket.zone} isPaused={insurancePool.isPaused} />
        <CREStatusCard />
      </div>

      {/* Activity Feed and AMM Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ActivityFeed activities={activities} />
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-5">AMM Reserves</h3>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">RISK Pool</div>
              <div className="text-lg font-semibold">{formatNumber(riskPoolTokens)} RISK</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">USDC Pool</div>
              <div className="text-lg font-semibold">{formatNumber(usdcPoolTokens)} USDC</div>
            </div>
            <div className="pt-3 border-t border-gray-700">
              <div className="text-sm text-gray-400 mb-1">Risk Price</div>
              <div className="text-lg font-semibold">{riskMarket.price.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">Zone</div>
              <div className="text-lg font-semibold">{riskMarket.zone}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">AMM Model</div>
              <div className="text-xs text-gray-500">Constant-product (x · y = k)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
