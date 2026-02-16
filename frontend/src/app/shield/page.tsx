'use client';

import { useRiskMarket, useShieldVault } from '@/hooks/useContracts';
import { useState } from 'react';

type TxStatus = 'idle' | 'pending' | 'success' | 'error';

const ZONE_LABELS: Record<string, string> = {
  Green: 'NORMAL',
  Yellow: 'ELEVATED',
  Orange: 'WARNING',
  Red: 'CRITICAL',
};

const ZONE_COLORS: Record<string, string> = {
  Green: 'text-zone-green',
  Yellow: 'text-zone-yellow',
  Orange: 'text-zone-orange',
  Red: 'text-zone-red',
};

function ProtectionBar({ level }: { level: number }) {
  const pct = level === 0 ? 0 : level === 1 ? 50 : 100;
  const label = level === 0 ? 'None' : level === 1 ? 'Partial (50%)' : 'Full (100%)';
  const color = level === 0 ? 'bg-gray-600' : level === 1 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-gray-400">Protection Level</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-3">
        <div
          className={`${color} h-3 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ShieldActive({ deposit, protectionLevel, zone }: {
  deposit: string;
  protectionLevel: number;
  zone: string;
}) {
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');

  const handleDeactivate = async () => {
    setTxStatus('pending');
    setTimeout(() => {
      setTxStatus('success');
      setTimeout(() => setTxStatus('idle'), 3000);
    }, 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Status Header */}
      <div className="bg-green-900/20 border border-green-700/40 rounded-2xl p-8 text-center">
        <div className="text-6xl mb-4">&#x1F6E1;&#xFE0F;</div>
        <div className="flex items-center justify-center space-x-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-2xl font-bold text-green-400">Shield Active</span>
        </div>
        <p className="text-gray-400">Your position is protected by PRISM insurance</p>
      </div>

      {/* Details */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 space-y-5">
        <div className="flex justify-between">
          <span className="text-gray-400">Deposit Amount</span>
          <span className="font-semibold text-lg">${parseFloat(deposit).toLocaleString()} USDC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Premium Paid</span>
          <span className="font-medium">${(parseFloat(deposit) * 0.02).toFixed(2)} USDC</span>
        </div>
        <ProtectionBar level={protectionLevel} />
        <div className="flex justify-between">
          <span className="text-gray-400">Current Zone</span>
          <span className={`font-semibold ${ZONE_COLORS[zone] || 'text-green-400'}`}>
            {zone} — {ZONE_LABELS[zone] || 'NORMAL'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Protected Protocol</span>
          <span className="font-mono text-sm">Aave v3</span>
        </div>
      </div>

      {/* Deactivate */}
      <button
        onClick={handleDeactivate}
        disabled={txStatus === 'pending'}
        className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
          txStatus === 'pending'
            ? 'bg-gray-600 cursor-wait'
            : txStatus === 'success'
              ? 'bg-green-600'
              : 'bg-red-600/80 hover:bg-red-600'
        }`}
      >
        {txStatus === 'pending'
          ? 'Deactivating...'
          : txStatus === 'success'
            ? 'Shield Deactivated'
            : 'Deactivate Shield'}
      </button>
      {txStatus === 'pending' && (
        <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400">
          <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
          <span>Transaction pending...</span>
        </div>
      )}
    </div>
  );
}

function ShieldActivation({ zone }: { zone: string }) {
  const [step, setStep] = useState(1);
  const [depositAmount, setDepositAmount] = useState('');
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');

  const parsedDeposit = parseFloat(depositAmount) || 0;
  const premiumCost = parsedDeposit * 0.02; // 2% premium
  const isWorldIdVerified = false; // Mock

  const handleDeposit = () => {
    if (parsedDeposit <= 0) return;
    setTxStatus('pending');
    setTimeout(() => {
      setTxStatus('success');
      setStep(2);
      setTimeout(() => setTxStatus('idle'), 1000);
    }, 2000);
  };

  const handleActivate = () => {
    setTxStatus('pending');
    setTimeout(() => {
      setTxStatus('success');
      setTimeout(() => setTxStatus('idle'), 3000);
    }, 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-gray-800/50 rounded-2xl p-8 border border-gray-700 text-center">
        <div className="text-6xl mb-4">&#x1F6E1;&#xFE0F;</div>
        <h2 className="text-2xl font-bold mb-2">Activate Shield Mode</h2>
        <p className="text-gray-400">
          Protect your DeFi position with PRISM insurance. Deposit USDC and activate your shield.
        </p>
      </div>

      {/* Step 1: Deposit */}
      <div className={`bg-gray-800/50 rounded-xl border transition-colors ${
        step === 1 ? 'border-blue-500' : step > 1 ? 'border-green-700/40' : 'border-gray-700'
      }`}>
        <div className="flex items-center space-x-3 p-5 border-b border-gray-700">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step > 1 ? 'bg-green-600' : step === 1 ? 'bg-blue-600' : 'bg-gray-700'
          }`}>
            {step > 1 ? '\u2713' : '1'}
          </div>
          <span className="font-semibold">Deposit USDC</span>
        </div>
        {step === 1 && (
          <div className="p-5 space-y-4">
            <div className="relative">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-blue-500 transition-colors"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">USDC</span>
            </div>
            <button
              onClick={handleDeposit}
              disabled={parsedDeposit <= 0 || txStatus === 'pending'}
              className={`w-full py-3 rounded-lg font-semibold transition-all ${
                txStatus === 'pending'
                  ? 'bg-gray-600 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500'
              }`}
            >
              {txStatus === 'pending' ? 'Depositing...' : 'Deposit USDC'}
            </button>
          </div>
        )}
        {step > 1 && (
          <div className="p-5 text-green-400 text-sm">
            Deposited ${parsedDeposit.toLocaleString()} USDC
          </div>
        )}
      </div>

      {/* Step 2: World ID */}
      <div className={`bg-gray-800/50 rounded-xl border transition-colors ${
        step === 2 ? 'border-blue-500' : step > 2 ? 'border-green-700/40' : 'border-gray-700'
      }`}>
        <div className="flex items-center space-x-3 p-5 border-b border-gray-700">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step > 2 ? 'bg-green-600' : step === 2 ? 'bg-blue-600' : 'bg-gray-700'
          }`}>
            {step > 2 ? '\u2713' : '2'}
          </div>
          <span className="font-semibold">World ID Verification</span>
        </div>
        {step === 2 && (
          <div className="p-5 space-y-4">
            {isWorldIdVerified ? (
              <div className="flex items-center space-x-2 text-green-400">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span>World ID verified — 5x trade impact active</span>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-400">
                  World ID verification is optional but provides 5x trade impact on your shield.
                </p>
                <div className="flex space-x-3">
                  <button className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-sm transition-colors">
                    Verify with World ID
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium text-sm transition-colors"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {step > 2 && (
          <div className="p-5 text-gray-400 text-sm">
            {isWorldIdVerified ? 'Verified' : 'Skipped'}
          </div>
        )}
      </div>

      {/* Step 3: Preview Premium */}
      <div className={`bg-gray-800/50 rounded-xl border transition-colors ${
        step === 3 ? 'border-blue-500' : step > 3 ? 'border-green-700/40' : 'border-gray-700'
      }`}>
        <div className="flex items-center space-x-3 p-5 border-b border-gray-700">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step > 3 ? 'bg-green-600' : step === 3 ? 'bg-blue-600' : 'bg-gray-700'
          }`}>
            {step > 3 ? '\u2713' : '3'}
          </div>
          <span className="font-semibold">Premium Preview</span>
        </div>
        {step === 3 && (
          <div className="p-5 space-y-4">
            <div className="bg-gray-900/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Deposit</span>
                <span>${parsedDeposit.toLocaleString()} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Premium Rate</span>
                <span>2.0%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Premium Cost</span>
                <span className="text-yellow-400 font-medium">${premiumCost.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Current Zone</span>
                <span className={ZONE_COLORS[zone] || 'text-green-400'}>
                  {zone} — {ZONE_LABELS[zone] || 'NORMAL'}
                </span>
              </div>
              <div className="border-t border-gray-700 pt-3 flex justify-between font-semibold">
                <span>Total Required</span>
                <span>${(parsedDeposit + premiumCost).toFixed(2)} USDC</span>
              </div>
            </div>
            <button
              onClick={() => setStep(4)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
            >
              Confirm Premium
            </button>
          </div>
        )}
        {step > 3 && (
          <div className="p-5 text-green-400 text-sm">
            Premium: ${premiumCost.toFixed(2)} USDC
          </div>
        )}
      </div>

      {/* Step 4: Activate */}
      <div className={`bg-gray-800/50 rounded-xl border transition-colors ${
        step === 4 ? 'border-green-500' : 'border-gray-700'
      }`}>
        <div className="flex items-center space-x-3 p-5 border-b border-gray-700">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step === 4 ? 'bg-green-600' : 'bg-gray-700'
          }`}>
            4
          </div>
          <span className="font-semibold">Activate Shield</span>
        </div>
        {step === 4 && (
          <div className="p-5">
            <button
              onClick={handleActivate}
              disabled={txStatus === 'pending'}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                txStatus === 'pending'
                  ? 'bg-gray-600 cursor-wait'
                  : txStatus === 'success'
                    ? 'bg-green-600'
                    : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {txStatus === 'pending'
                ? 'Activating Shield...'
                : txStatus === 'success'
                  ? 'Shield Activated!'
                  : 'Activate Shield Mode'}
            </button>
            {txStatus === 'pending' && (
              <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400 mt-3">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                <span>Transaction pending...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ShieldPage() {
  const riskMarket = useRiskMarket();
  const shieldVault = useShieldVault();

  if (riskMarket.loading || shieldVault.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xl text-gray-400">Loading shield data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Shield Mode</h1>
        <p className="text-gray-400">Protect your DeFi positions with PRISM autonomous insurance</p>
      </div>

      {shieldVault.shieldActive ? (
        <ShieldActive
          deposit={shieldVault.deposit}
          protectionLevel={shieldVault.protectionLevel}
          zone={riskMarket.zone}
        />
      ) : (
        <ShieldActivation zone={riskMarket.zone} />
      )}
    </div>
  );
}
