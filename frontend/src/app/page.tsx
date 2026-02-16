'use client';

import { useRiskMarket, useInsurancePool } from '@/hooks/useContracts';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area } from 'recharts';
import { useState, useEffect } from 'react';

// Mock price history data
const generateMockPriceHistory = (currentPrice: number) => {
  const data = [];
  const now = Date.now();
  let price = currentPrice - 1 + Math.random() * 2;

  for (let i = 23; i >= 0; i--) {
    data.push({
      time: new Date(now - i * 3600000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      price: Math.max(0, Math.min(100, price + (Math.random() - 0.5) * 2)),
    });
    price = data[data.length - 1].price;
  }

  return data;
};

// Mock activity feed
const generateMockActivity = () => [
  { id: 1, time: '2 mins ago', description: 'Shield activated for 0x1234...5678', type: 'shield' },
  { id: 2, time: '15 mins ago', description: 'Risk market trade: 100 RISK @ 3.2%', type: 'trade' },
  { id: 3, time: '1 hour ago', description: 'AI Risk Agent updated price to 3.1%', type: 'ai' },
  { id: 4, time: '2 hours ago', description: 'Zone change: Green → Yellow', type: 'zone' },
  { id: 5, time: '3 hours ago', description: 'Reserve verification completed', type: 'system' },
  { id: 6, time: '4 hours ago', description: 'Pool health updated', type: 'system' },
];

function RiskZoneIndicator({ zone, price }: { zone: string; price: number }) {
  const zoneConfig = {
    Green: { bg: 'bg-zone-green', label: 'NORMAL', pulse: false },
    Yellow: { bg: 'bg-zone-yellow', label: 'ELEVATED', pulse: false },
    Orange: { bg: 'bg-zone-orange', label: 'WARNING', pulse: true },
    Red: { bg: 'bg-zone-red', label: 'CRITICAL', pulse: true },
  };

  const config = zoneConfig[zone as keyof typeof zoneConfig] || zoneConfig.Green;

  return (
    <div className={`${config.bg} rounded-2xl p-12 text-center relative overflow-hidden ${config.pulse ? 'animate-pulse-slow' : ''}`}>
      <div className="relative z-10">
        <div className="text-7xl font-bold mb-4">{price.toFixed(1)}%</div>
        <div className="text-2xl font-semibold tracking-wider">{config.label}</div>
        <div className="text-lg mt-2 opacity-90">{zone} Zone</div>
      </div>
      {config.pulse && (
        <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
      )}
    </div>
  );
}

function QuickStatsCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle: string; icon: string }) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="text-gray-400 text-sm font-medium">{title}</div>
        <div className="text-2xl">{icon}</div>
      </div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-sm text-gray-400">{subtitle}</div>
    </div>
  );
}

function PriceChart({ data, zone }: { data: any[]; zone: string }) {
  const zoneColors = {
    Green: '#2D6A4F',
    Yellow: '#E9C46A',
    Orange: '#F4A261',
    Red: '#E63946',
  };

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-xl font-semibold mb-6">Risk Price (24h)</h3>
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
            domain={[0, 50]}
            label={{ value: 'Risk Price (%)', angle: -90, position: 'insideLeft', style: { fill: '#9CA3AF' } }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#9CA3AF' }}
          />
          <ReferenceLine y={5} stroke="#2D6A4F" strokeDasharray="5 5" label={{ value: 'Green', fill: '#2D6A4F', fontSize: 12 }} />
          <ReferenceLine y={15} stroke="#E9C46A" strokeDasharray="5 5" label={{ value: 'Yellow', fill: '#E9C46A', fontSize: 12 }} />
          <ReferenceLine y={35} stroke="#F4A261" strokeDasharray="5 5" label={{ value: 'Orange', fill: '#F4A261', fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="price"
            stroke={zoneColors[zone as keyof typeof zoneColors] || '#2D6A4F'}
            strokeWidth={3}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActivityFeed({ activities }: { activities: any[] }) {
  const typeColors = {
    trade: 'text-blue-400',
    shield: 'text-green-400',
    zone: 'text-orange-400',
    ai: 'text-purple-400',
    system: 'text-gray-400',
  };

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-xl font-semibold mb-6">Recent Activity</h3>
      <div className="space-y-4">
        {activities.map((activity) => (
          <div key={activity.id} className="flex items-start space-x-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
            <div className="flex-1">
              <div className={`font-medium ${typeColors[activity.type as keyof typeof typeColors] || 'text-gray-300'}`}>
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

export default function Dashboard() {
  const riskMarket = useRiskMarket();
  const insurancePool = useInsurancePool();
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [activities] = useState(generateMockActivity());

  useEffect(() => {
    if (!riskMarket.loading) {
      setPriceHistory(generateMockPriceHistory(riskMarket.price));
    }
  }, [riskMarket.price, riskMarket.loading]);

  // Calculate pool solvency ratio
  const poolSolvency = insurancePool.loading
    ? 0
    : (parseFloat(insurancePool.totalLiquidity) / Math.max(parseFloat(insurancePool.totalClaims), 1)) * 100;

  if (riskMarket.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xl text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero Section - Risk Zone Indicator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <RiskZoneIndicator zone={riskMarket.zone} price={riskMarket.price} />
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
            <div className="text-lg font-semibold">
              {riskMarket.isResolved ? '🔒 Resolved' : '✅ Active'}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <QuickStatsCard
          title="Insurance Pool"
          value={`$${(parseFloat(insurancePool.totalLiquidity) / 1e6).toFixed(2)}M`}
          subtitle={`${insurancePool.utilization / 100}% utilized`}
          icon="💰"
        />
        <QuickStatsCard
          title="Active Shields"
          value="12"
          subtitle="Users protected"
          icon="🛡️"
        />
        <QuickStatsCard
          title="Pool Solvency"
          value={`${poolSolvency.toFixed(0)}%`}
          subtitle={insurancePool.isPaused ? 'Paused' : 'Healthy'}
          icon="📊"
        />
        <QuickStatsCard
          title="AI Risk Agent"
          value="Active"
          subtitle="Last update: 3 mins ago"
          icon="🤖"
        />
      </div>

      {/* Price Chart */}
      {priceHistory.length > 0 && (
        <PriceChart data={priceHistory} zone={riskMarket.zone} />
      )}

      {/* Activity Feed and Market Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <ActivityFeed activities={activities} />
        </div>
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h3 className="text-xl font-semibold mb-6">Market Info</h3>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">Total RISK Tokens</div>
              <div className="text-lg font-semibold">
                {(parseFloat(riskMarket.totalRisk) / 1e6).toFixed(2)}M
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">Total USDC Liquidity</div>
              <div className="text-lg font-semibold">
                ${(parseFloat(riskMarket.totalUsdc) / 1e6).toFixed(2)}M
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">Current Zone</div>
              <div className="text-lg font-semibold">{riskMarket.zone}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">CRE Workflows</div>
              <div className="text-sm space-y-1">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span>Risk Monitor</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span>AI Risk Agent</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span>Threshold Controller</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span>Reserve Verifier</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span>World ID Verifier</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
