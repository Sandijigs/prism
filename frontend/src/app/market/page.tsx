'use client';

import { useRiskMarket } from '@/hooks/useContracts';
import { useState } from 'react';

type TradeTab = 'buy' | 'sell';
type TxStatus = 'idle' | 'pending' | 'success' | 'error';

const ZONE_COLORS: Record<string, string> = {
  Green: 'text-zone-green',
  Yellow: 'text-zone-yellow',
  Orange: 'text-zone-orange',
  Red: 'text-zone-red',
};

const ZONE_BG: Record<string, string> = {
  Green: 'bg-zone-green/20 border-zone-green/40',
  Yellow: 'bg-zone-yellow/20 border-zone-yellow/40',
  Orange: 'bg-zone-orange/20 border-zone-orange/40',
  Red: 'bg-zone-red/20 border-zone-red/40',
};

function MarketHeader({ price, zone, totalRisk, totalUsdc }: {
  price: number;
  zone: string;
  totalRisk: string;
  totalUsdc: string;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <div className="text-sm text-gray-400 mb-1">Risk Price</div>
        <div className="text-3xl font-bold">{price.toFixed(2)}%</div>
        <div className="text-sm text-green-400 mt-1">+0.3% (24h)</div>
      </div>
      <div className={`rounded-xl p-5 border ${ZONE_BG[zone] || ZONE_BG.Green}`}>
        <div className="text-sm text-gray-400 mb-1">Risk Zone</div>
        <div className={`text-3xl font-bold ${ZONE_COLORS[zone] || ZONE_COLORS.Green}`}>{zone}</div>
        <div className="text-sm text-gray-400 mt-1">
          {zone === 'Green' ? '< 5%' : zone === 'Yellow' ? '5-15%' : zone === 'Orange' ? '15-35%' : '> 35%'}
        </div>
      </div>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <div className="text-sm text-gray-400 mb-1">24h Volume</div>
        <div className="text-3xl font-bold">$124K</div>
        <div className="text-sm text-gray-400 mt-1">328 trades</div>
      </div>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <div className="text-sm text-gray-400 mb-1">Liquidity</div>
        <div className="text-3xl font-bold">${(parseFloat(totalUsdc) / 1e6).toFixed(1)}M</div>
        <div className="text-sm text-gray-400 mt-1">{(parseFloat(totalRisk) / 1e6).toFixed(1)}M RISK</div>
      </div>
    </div>
  );
}

function TradingPanel({ price }: { price: number }) {
  const [tab, setTab] = useState<TradeTab>('buy');
  const [amount, setAmount] = useState('');
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');

  const parsedAmount = parseFloat(amount) || 0;

  // Estimate output: buy RISK with USDC or sell RISK for USDC
  const estimatedOutput = tab === 'buy'
    ? parsedAmount > 0 ? (parsedAmount / (price / 100)).toFixed(2) : '0.00'
    : parsedAmount > 0 ? (parsedAmount * (price / 100)).toFixed(2) : '0.00';

  const handleTrade = async () => {
    if (parsedAmount <= 0) return;
    setTxStatus('pending');
    // Simulate transaction
    setTimeout(() => {
      setTxStatus('success');
      setTimeout(() => setTxStatus('idle'), 3000);
    }, 2000);
  };

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700">
      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setTab('buy')}
          className={`flex-1 py-4 text-center font-semibold transition-colors ${
            tab === 'buy'
              ? 'text-green-400 border-b-2 border-green-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          BUY RISK
        </button>
        <button
          onClick={() => setTab('sell')}
          className={`flex-1 py-4 text-center font-semibold transition-colors ${
            tab === 'sell'
              ? 'text-red-400 border-b-2 border-red-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          SELL RISK
        </button>
      </div>

      <div className="p-6 space-y-5">
        {/* Input */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            {tab === 'buy' ? 'Amount (USDC)' : 'Amount (RISK)'}
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-blue-500 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              {tab === 'buy' ? 'USDC' : 'RISK'}
            </span>
          </div>
        </div>

        {/* Estimated Output */}
        <div className="bg-gray-900/50 rounded-lg p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Estimated Output</span>
            <span className="text-white font-medium">
              {estimatedOutput} {tab === 'buy' ? 'RISK' : 'USDC'}
            </span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Price</span>
            <span className="text-white">{price.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Slippage (max)</span>
            <span className="text-white">0.5%</span>
          </div>
        </div>

        {/* Execute Button */}
        <button
          onClick={handleTrade}
          disabled={parsedAmount <= 0 || txStatus === 'pending'}
          className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
            txStatus === 'pending'
              ? 'bg-gray-600 cursor-wait'
              : txStatus === 'success'
                ? 'bg-green-600'
                : tab === 'buy'
                  ? 'bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500'
                  : 'bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500'
          }`}
        >
          {txStatus === 'pending'
            ? 'Executing...'
            : txStatus === 'success'
              ? 'Trade Successful!'
              : `Execute ${tab === 'buy' ? 'Buy' : 'Sell'}`}
        </button>

        {/* Tx Status */}
        {txStatus === 'pending' && (
          <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400">
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
            <span>Transaction pending...</span>
          </div>
        )}
        {txStatus === 'success' && (
          <div className="flex items-center justify-center space-x-2 text-sm text-green-400">
            <div className="w-2 h-2 rounded-full bg-green-400"></div>
            <span>Transaction confirmed</span>
          </div>
        )}
      </div>
    </div>
  );
}

function UserPosition({ price }: { price: number }) {
  // Mock user position
  const riskBalance = 500;
  const avgPrice = 2.8;
  const currentValue = riskBalance * (price / 100);
  const pnl = ((price - avgPrice) / avgPrice) * 100;

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Your Position</h3>
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-gray-400">RISK Balance</span>
          <span className="font-medium">{riskBalance.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Avg. Entry Price</span>
          <span className="font-medium">{avgPrice.toFixed(2)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Current Value</span>
          <span className="font-medium">${currentValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">P&L</span>
          <span className={`font-medium ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function WorldIdBadge() {
  // Mock verification status
  const isVerified = false;

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">World ID</h3>
      {isVerified ? (
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center text-xl">
            &#x2713;
          </div>
          <div>
            <div className="font-medium text-green-400">Verified</div>
            <div className="text-xs text-gray-400">5x trade impact active</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-xl">
              ?
            </div>
            <div>
              <div className="font-medium text-gray-300">Not Verified</div>
              <div className="text-xs text-gray-400">Verify for 5x trade impact</div>
            </div>
          </div>
          <button className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-sm transition-colors">
            Verify with World ID
          </button>
        </div>
      )}
    </div>
  );
}

export default function MarketPage() {
  const riskMarket = useRiskMarket();

  if (riskMarket.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xl text-gray-400">Loading market data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Risk Market</h1>
        <p className="text-gray-400">Trade risk tokens on the PRISM constant-product AMM</p>
      </div>

      <MarketHeader
        price={riskMarket.price}
        zone={riskMarket.zone}
        totalRisk={riskMarket.totalRisk}
        totalUsdc={riskMarket.totalUsdc}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <TradingPanel price={riskMarket.price} />
        </div>
        <div className="space-y-6">
          <UserPosition price={riskMarket.price} />
          <WorldIdBadge />
        </div>
      </div>
    </div>
  );
}
