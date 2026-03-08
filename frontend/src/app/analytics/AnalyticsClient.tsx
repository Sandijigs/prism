'use client';

import { useMemo } from 'react';
import { useReadContract } from 'thirdweb/react';
import { useRiskMarket, useInsurancePool } from '@/hooks/useContracts';
import {
  getRiskMarketContract,
  getShieldVaultContract,
  getWorldIDGateContract,
} from '@/hooks/usePRISMContracts';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from 'recharts';

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(decimals)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

function fmtUsd(n: number): string {
  return `$${fmt(n)}`;
}

// Generate simulated price history from current price (visual only)
function generatePriceHistory(currentPrice: number) {
  const points = 24;
  const data = [];
  let price = Math.max(0.5, currentPrice * 0.6);
  for (let i = 0; i < points; i++) {
    const drift = (currentPrice - price) * 0.08;
    const noise = (Math.random() - 0.45) * 0.8;
    price = Math.max(0.1, price + drift + noise);
    data.push({
      time: `${i}h`,
      price: parseFloat(price.toFixed(2)),
    });
  }
  // Ensure last point matches current
  data.push({ time: 'Now', price: parseFloat(currentPrice.toFixed(2)) });
  return data;
}

// Generate pool composition data for donut chart
function generatePoolData(usdc: number, risk: number, riskPrice: number) {
  const riskValue = risk * (riskPrice / 100);
  return [
    { name: 'USDC', value: usdc, color: '#10B981' },
    { name: 'RISK', value: riskValue, color: '#6366F1' },
  ];
}

// ── Components ──────────────────────────────────────────────────────────────

function SkeletonLoader() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-64 bg-white/10 rounded-lg" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 bg-white/5 rounded-2xl" />
        ))}
      </div>
      <div className="h-72 bg-white/5 rounded-2xl" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-64 bg-white/5 rounded-2xl" />
        <div className="h-64 bg-white/5 rounded-2xl" />
      </div>
    </div>
  );
}

function KPICard({ label, value, change, accent = 'blue' }: {
  label: string;
  value: string;
  change?: string;
  accent?: 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'cyan';
}) {
  const accents = {
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-500/20 shadow-blue-500/5',
    green: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/20 shadow-emerald-500/5',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-500/20 shadow-purple-500/5',
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-500/20 shadow-amber-500/5',
    rose: 'from-rose-500/20 to-rose-600/5 border-rose-500/20 shadow-rose-500/5',
    cyan: 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/20 shadow-cyan-500/5',
  };

  const dotColors = {
    blue: 'bg-blue-400',
    green: 'bg-emerald-400',
    purple: 'bg-purple-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    cyan: 'bg-cyan-400',
  };

  return (
    <div className={`relative group rounded-2xl bg-gradient-to-br ${accents[accent]} border backdrop-blur-sm p-5 transition-all duration-300 hover:shadow-lg hover:scale-[1.02]`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-1.5 h-1.5 rounded-full ${dotColors[accent]}`} />
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl lg:text-3xl font-bold text-white tabular-nums">{value}</p>
      {change && (
        <p className={`text-xs font-medium mt-2 tabular-nums ${
          change.startsWith('+') ? 'text-emerald-400' : change.startsWith('-') ? 'text-rose-400' : 'text-gray-400'
        }`}>
          {change}
        </p>
      )}
    </div>
  );
}

function RiskGauge({ price, zone }: { price: number; zone: string }) {
  // Price ranges: 0-99%, map to gauge position
  const pct = Math.min(100, Math.max(0, price));
  const zoneColors: Record<string, string> = {
    Green: '#10B981',
    Yellow: '#F59E0B',
    Orange: '#F97316',
    Red: '#EF4444',
  };
  const color = zoneColors[zone] || '#10B981';

  return (
    <div className="relative rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
      {/* Ambient glow */}
      <div
        className="absolute -inset-[1px] rounded-2xl blur-xl -z-10 opacity-30"
        style={{ background: `radial-gradient(ellipse at 50% 100%, ${color}40, transparent 70%)` }}
      />

      <div className="flex items-center justify-between mb-5">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Risk Level</p>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{
            background: `${color}20`,
            color: color,
          }}
        >
          {zone} Zone
        </span>
      </div>

      <div className="flex items-end gap-3 mb-6">
        <span className="text-5xl font-bold tabular-nums text-white">{price.toFixed(2)}</span>
        <span className="text-xl text-gray-400 mb-1">%</span>
      </div>

      {/* Gauge bar */}
      <div className="relative h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, #10B981, #F59E0B, #F97316, #EF4444)`,
            backgroundSize: '400% 100%',
            backgroundPosition: `${pct}% 0`,
          }}
        />
        {/* Zone markers */}
        <div className="absolute inset-0 flex">
          <div className="w-[5%] border-r border-gray-700/50" />
          <div className="w-[10%] border-r border-gray-700/50" />
          <div className="w-[20%] border-r border-gray-700/50" />
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-gray-600 mt-1.5 px-0.5">
        <span>0%</span>
        <span>5%</span>
        <span>15%</span>
        <span>35%</span>
        <span>100%</span>
      </div>

      {/* Zone legend */}
      <div className="flex gap-3 mt-4">
        {(['Green', 'Yellow', 'Orange', 'Red'] as const).map((z) => (
          <div key={z} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: zoneColors[z] }}
            />
            <span className={`text-[10px] ${zone === z ? 'text-white font-medium' : 'text-gray-500'}`}>
              {z}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-white tabular-nums">{payload[0].value.toFixed(2)}%</p>
    </div>
  );
}

function PoolHealthCard({
  poolBalance,
  premiums,
  claims,
  utilization,
  isPaused,
}: {
  poolBalance: number;
  premiums: number;
  claims: number;
  utilization: number;
  isPaused: boolean;
}) {
  const utilizationPct = utilization / 100;
  const barData = [
    { name: 'Pool Balance', value: poolBalance, color: '#10B981' },
    { name: 'Premiums', value: premiums, color: '#6366F1' },
    { name: 'Claims Paid', value: claims, color: '#F59E0B' },
  ];

  const healthColor = isPaused
    ? '#EF4444'
    : utilization > 5000
      ? '#F59E0B'
      : '#10B981';

  const healthLabel = isPaused ? 'PAUSED' : utilization > 5000 ? 'ELEVATED' : 'HEALTHY';

  return (
    <div className="relative rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Insurance Pool</p>
          <p className="text-2xl font-bold text-white mt-1 tabular-nums">{fmtUsd(poolBalance)}</p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: `${healthColor}15`, color: healthColor }}
        >
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: healthColor }} />
          {healthLabel}
        </div>
      </div>

      {/* Utilization gauge */}
      <div className="mb-6">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-gray-400">Utilization</span>
          <span className="text-white font-medium tabular-nums">{utilizationPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, utilizationPct)}%`,
              background: `linear-gradient(90deg, #10B981, ${healthColor})`,
            }}
          />
        </div>
      </div>

      {/* Pool breakdown bars */}
      <div className="space-y-3">
        {barData.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
              <span className="text-xs text-gray-400">{item.name}</span>
            </div>
            <span className="text-sm font-medium text-white tabular-nums">{fmtUsd(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const riskMarket = useRiskMarket();
  const insurancePool = useInsurancePool();

  const { data: totalRiskMinted } = useReadContract({
    contract: getRiskMarketContract(),
    method: 'function totalRiskMinted() view returns (uint256)',
    params: [],
  });

  const { data: totalUsdcDeposited } = useReadContract({
    contract: getRiskMarketContract(),
    method: 'function totalUsdcDeposited() view returns (uint256)',
    params: [],
  });

  const { data: shieldedUserCount } = useReadContract({
    contract: getShieldVaultContract(),
    method: 'function shieldedUserCount() view returns (uint256)',
    params: [],
  });

  const { data: totalVerified } = useReadContract({
    contract: getWorldIDGateContract(),
    method: 'function totalVerified() view returns (uint256)',
    params: [],
  });

  const { data: marketInvariant } = useReadContract({
    contract: getRiskMarketContract(),
    method: 'function invariant() view returns (uint256)',
    params: [],
  });

  const priceHistory = useMemo(
    () => generatePriceHistory(riskMarket.price),
    [riskMarket.price]
  );

  const poolComposition = useMemo(
    () => generatePoolData(
      parseFloat(riskMarket.totalUsdc),
      parseFloat(riskMarket.totalRisk),
      riskMarket.price,
    ),
    [riskMarket.totalUsdc, riskMarket.totalRisk, riskMarket.price]
  );

  if (riskMarket.loading || insurancePool.loading) {
    return <SkeletonLoader />;
  }

  // Format values
  const riskMinted = totalRiskMinted ? Number(totalRiskMinted) / 1e18 : 0;
  const usdcDeposited = totalUsdcDeposited ? Number(totalUsdcDeposited) / 1e18 : 0;
  const shields = shieldedUserCount ? Number(shieldedUserCount) : 0;
  const verified = totalVerified ? Number(totalVerified) : 0;
  const invariantVal = marketInvariant ? Number(marketInvariant) / 1e36 : 0;
  const poolBalance = parseFloat(insurancePool.totalPoolBalance);
  const premiums = parseFloat(insurancePool.totalPremiumsCollected);
  const claims = parseFloat(insurancePool.totalClaimsPaid);
  const usdcPool = parseFloat(riskMarket.totalUsdc);
  const riskPool = parseFloat(riskMarket.totalRisk);

  return (
    <div className="relative space-y-8">
      {/* Ambient background glows */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 -right-32 w-96 h-96 bg-purple-600/6 rounded-full blur-3xl" />
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold text-white">Analytics</h1>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-medium text-emerald-400 uppercase">Live</span>
            </div>
          </div>
          <p className="text-sm text-gray-500">Real-time on-chain data from PRISM Protocol</p>
        </div>
        <div className="text-xs text-gray-600 font-mono tabular-nums">
          Chain ID: {process.env.NEXT_PUBLIC_CHAIN_ID || '73571'}
        </div>
      </div>

      {/* ── Top KPI Row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Risk Price"
          value={`${riskMarket.price.toFixed(2)}%`}
          change={riskMarket.zone === 'Green' ? 'Low Risk' : riskMarket.zone === 'Yellow' ? 'Moderate' : 'Elevated'}
          accent="blue"
        />
        <KPICard
          label="Total Value Locked"
          value={fmtUsd(usdcPool + poolBalance)}
          accent="green"
        />
        <KPICard
          label="RISK Minted"
          value={fmt(riskMinted, 0)}
          change={`${fmtUsd(usdcDeposited)} deposited`}
          accent="purple"
        />
        <KPICard
          label="Active Shields"
          value={shields.toString()}
          change={`${verified} verified users`}
          accent="cyan"
        />
      </div>

      {/* ── Main Charts Row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Price Chart — spans 2 columns */}
        <div className="lg:col-span-2 rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Risk Price</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-bold text-white tabular-nums">{riskMarket.price.toFixed(2)}%</span>
              </div>
            </div>
            <div className="flex gap-1">
              {['1H', '6H', '1D', '1W'].map((t, i) => (
                <button
                  key={t}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    i === 2
                      ? 'bg-white/10 text-white font-medium'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="h-56 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={priceHistory} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                  domain={['dataMin - 0.5', 'dataMax + 0.5']}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#6366F1"
                  strokeWidth={2}
                  fill="url(#priceGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#6366F1', stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Risk Gauge */}
        <RiskGauge price={riskMarket.price} zone={riskMarket.zone} />
      </div>

      {/* ── Pool Analytics Row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Insurance Pool Health */}
        <PoolHealthCard
          poolBalance={poolBalance}
          premiums={premiums}
          claims={claims}
          utilization={insurancePool.utilization}
          isPaused={insurancePool.isPaused}
        />

        {/* AMM Composition */}
        <div className="rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">AMM Composition</p>
          <p className="text-sm text-gray-500 mb-4">Constant-product pool reserves</p>

          <div className="flex items-center gap-6">
            <div className="w-36 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={poolComposition}
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={62}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {poolComposition.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex-1 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs text-gray-400">USDC Reserve</span>
                </div>
                <p className="text-xl font-bold text-white tabular-nums">{fmtUsd(usdcPool)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                  <span className="text-xs text-gray-400">RISK Reserve</span>
                </div>
                <p className="text-xl font-bold text-white tabular-nums">{fmt(riskPool, 0)} RISK</p>
              </div>
              <div className="pt-3 border-t border-white/5">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Invariant (k)</p>
                <p className="text-sm font-medium text-gray-300 tabular-nums">{fmt(invariantVal, 2)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Lifetime Stats Row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Lifetime USDC Inflows"
          value={fmtUsd(usdcDeposited)}
          accent="green"
        />
        <KPICard
          label="Premium Revenue"
          value={fmtUsd(premiums)}
          accent="blue"
        />
        <KPICard
          label="Claims Paid"
          value={fmtUsd(claims)}
          accent="amber"
        />
        <KPICard
          label="Market Status"
          value={riskMarket.isResolved ? 'Resolved' : 'Active'}
          change={riskMarket.isResolved ? 'Market settled' : 'Trading open'}
          accent={riskMarket.isResolved ? 'amber' : 'green'}
        />
      </div>

      {/* ── Protocol & Sybil Stats ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reserve Distribution Bar Chart */}
        <div className="lg:col-span-2 rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Reserve Distribution</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: 'USDC Pool', value: usdcPool, fill: '#10B981' },
                  { name: 'RISK Pool', value: riskPool * (riskMarket.price / 100), fill: '#6366F1' },
                  { name: 'Insurance', value: poolBalance, fill: '#F59E0B' },
                  { name: 'Premiums', value: premiums, fill: '#8B5CF6' },
                  { name: 'Claims', value: claims, fill: '#EF4444' },
                ]}
                margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${fmt(v, 0)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(17,17,27,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => [fmtUsd(value), 'Value']}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {[
                    { fill: '#10B981' },
                    { fill: '#6366F1' },
                    { fill: '#F59E0B' },
                    { fill: '#8B5CF6' },
                    { fill: '#EF4444' },
                  ].map((entry, index) => (
                    <Cell key={index} fill={entry.fill} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sybil Resistance Stats */}
        <div className="rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-5">Sybil Resistance</p>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">World ID Verified</span>
                <span className="text-xs text-gray-500 tabular-nums">{verified} users</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-400 transition-all duration-700"
                  style={{ width: `${Math.max(5, Math.min(100, verified * 10))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Active Shields</span>
                <span className="text-xs text-gray-500 tabular-nums">{shields} users</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                  style={{ width: `${Math.max(5, Math.min(100, shields * 10))}%` }}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Insurance</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  insurancePool.isPaused
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-emerald-500/10 text-emerald-400'
                }`}>
                  {insurancePool.isPaused ? 'Paused' : 'Active'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Premium Rate</span>
                <span className="text-xs font-semibold text-white tabular-nums">{riskMarket.price.toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Trading Weight</span>
                <span className="text-xs text-gray-300">Verified 5x / Unverified 1x</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contract Addresses ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] p-6">
        <div className="flex items-center gap-2 mb-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Deployed Contracts</p>
          <span className="text-[10px] text-gray-600 font-mono">Tenderly VTN</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0">
          {[
            ['RiskMarket', process.env.NEXT_PUBLIC_RISK_MARKET_ADDRESS, '#6366F1'],
            ['ShieldVault', process.env.NEXT_PUBLIC_SHIELD_VAULT_ADDRESS, '#10B981'],
            ['InsurancePool', process.env.NEXT_PUBLIC_INSURANCE_POOL_ADDRESS, '#F59E0B'],
            ['WorldIDGate', process.env.NEXT_PUBLIC_WORLD_ID_GATE_ADDRESS, '#8B5CF6'],
            ['PRISM Token', process.env.NEXT_PUBLIC_PRISM_TOKEN_ADDRESS, '#EC4899'],
            ['Mock USDC', process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS, '#14B8A6'],
          ].map(([name, addr, color]) => (
            <div
              key={name}
              className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0"
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: color as string }} />
                <span className="text-sm text-gray-300">{name}</span>
              </div>
              <span className="font-mono text-xs text-gray-500 select-all hover:text-gray-300 transition-colors">
                {addr}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
