'use client';

import { useRiskMarket, useShieldVault } from '@/hooks/useContracts';
import { useIsVerified } from '@/hooks/usePRISMContracts';
import { CONTRACTS, client, chain } from '@/lib/thirdweb';
import { useState, useCallback, useRef } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { getContract, readContract } from 'thirdweb';
import { ethers } from 'ethers';

type TxStatus = 'idle' | 'approving' | 'depositing' | 'activating' | 'deactivating' | 'success' | 'error';

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

// ── Thirdweb contract instances for writes ──────────────────────────────────

const usdcContract = getContract({ client, chain, address: CONTRACTS.mockUSDC });
const shieldVaultContract = getContract({ client, chain, address: CONTRACTS.shieldVault });

// Aave v3 Pool on mainnet (exists on our Tenderly mainnet fork)
const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

// ── Direct RPC for writes (bypasses thirdweb proxy which 404s on custom chains) ─
const RPC_URL = typeof chain.rpc === 'string' ? chain.rpc : (process.env.NEXT_PUBLIC_RPC_URL || '');

async function rpcCall(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function waitForReceipt(txHash: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    if (receipt) {
      if (receipt.status === '0x1') return;
      throw new Error('Transaction reverted on-chain');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Transaction not confirmed after 60s');
}

async function sendDirectTx(from: string, to: string, data: string): Promise<string> {
  const txHash = await rpcCall('eth_sendTransaction', [{
    from, to, data, gas: '0x100000',
  }]);
  return txHash;
}

// ── Components ──────────────────────────────────────────────────────────────

function ProtectionBar({ level }: { level: number }) {
  // Contract stores 0, 50, or 100
  const pct = level;
  const label = level === 0 ? 'None' : level === 50 ? 'Partial (50%)' : level === 100 ? 'Full (100%)' : `${level}%`;
  const color = level === 0 ? 'bg-gray-600' : level <= 50 ? 'bg-yellow-500' : 'bg-green-500';

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

function ShieldActive({ deposit, protectionLevel, zone, premiumPaid, protectedProtocol, securedAmount, onDeactivateSuccess }: {
  deposit: string;
  protectionLevel: number;
  zone: string;
  premiumPaid: string;
  protectedProtocol: string;
  securedAmount: string;
  onDeactivateSuccess: () => void;
}) {
  const account = useActiveAccount();
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const busyRef = useRef(false);

  const handleDeactivate = useCallback(async () => {
    if (!account || busyRef.current) return;
    busyRef.current = true;
    setErrorMsg('');

    const iface = new ethers.utils.Interface([
      'function deactivateShield()',
    ]);

    try {
      setTxStatus('deactivating');
      console.log('[PRISM] Deactivating shield...');
      const data = iface.encodeFunctionData('deactivateShield', []);
      const hash = await sendDirectTx(account.address, CONTRACTS.shieldVault, data);
      console.log('[PRISM] deactivateShield tx:', hash);
      await waitForReceipt(hash);
      console.log('[PRISM] Shield deactivated!');

      setTxStatus('success');
      onDeactivateSuccess();
      setTimeout(() => setTxStatus('idle'), 4000);
    } catch (err: any) {
      console.error('Deactivate failed:', err);
      setTxStatus('error');
      const msg = err?.reason || err?.data?.message || err?.message || 'Transaction failed';
      setErrorMsg(typeof msg === 'string' ? msg.slice(0, 150) : 'Transaction failed');
      setTimeout(() => setTxStatus('idle'), 5000);
    } finally {
      busyRef.current = false;
    }
  }, [account, onDeactivateSuccess]);

  const isBusy = txStatus === 'deactivating';

  // Show shortened protocol address or "Aave v3" for the known address
  const protocolLabel = protectedProtocol.toLowerCase() === AAVE_V3_POOL.toLowerCase()
    ? 'Aave v3'
    : protectedProtocol
      ? `${protectedProtocol.slice(0, 6)}...${protectedProtocol.slice(-4)}`
      : 'Unknown';

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
          <span className="text-gray-400">Deposit Balance</span>
          <span className="font-semibold text-lg">${parseFloat(deposit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Premium Paid</span>
          <span className="font-medium">${parseFloat(premiumPaid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Secured Amount</span>
          <span className="font-medium">${parseFloat(securedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
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
          <span className="font-mono text-sm">{protocolLabel}</span>
        </div>
      </div>

      {/* Deactivate */}
      <button
        onClick={handleDeactivate}
        disabled={isBusy || !account}
        className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
          isBusy
            ? 'bg-gray-600 cursor-wait'
            : txStatus === 'success'
              ? 'bg-green-600'
              : txStatus === 'error'
                ? 'bg-red-600'
                : 'bg-red-600/80 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500'
        }`}
      >
        {!account
          ? 'Connect Wallet'
          : isBusy
            ? 'Deactivating... (sign in wallet)'
            : txStatus === 'success'
              ? 'Shield Deactivated!'
              : txStatus === 'error'
                ? 'Deactivation Failed'
                : 'Deactivate Shield'}
      </button>
      {isBusy && (
        <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400">
          <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
          <span>Confirm deactivation in your wallet...</span>
        </div>
      )}
      {txStatus === 'success' && (
        <div className="flex items-center justify-center space-x-2 text-sm text-green-400">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span>Shield deactivated — you can now withdraw your deposit</span>
        </div>
      )}
      {txStatus === 'error' && errorMsg && (
        <div className="text-center text-sm text-red-400 break-words">{errorMsg}</div>
      )}
    </div>
  );
}

function ShieldActivation({ zone, riskPrice, onSuccess }: { zone: string; riskPrice: number; onSuccess: () => void }) {
  const account = useActiveAccount();
  const { data: isWorldIdVerified, isLoading: worldIdLoading } = useIsVerified(account?.address);
  const [step, setStep] = useState(1);
  const [depositAmount, setDepositAmount] = useState('');
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const busyRef = useRef(false);

  const parsedDeposit = parseFloat(depositAmount) || 0;
  // Premium = deposit * riskPrice / 100 (matches contract's calculatePremium)
  const premiumRate = riskPrice; // integer percentage 0-99
  const premiumCost = parsedDeposit * premiumRate / 100;

  // ── Step 1: Approve USDC + Deposit ────────────────────────────────────────
  const handleDeposit = useCallback(async () => {
    if (!account || parsedDeposit <= 0 || busyRef.current) return;
    busyRef.current = true;
    setErrorMsg('');

    const iface = new ethers.utils.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
      'function deposit(uint256 amount)',
    ]);

    try {
      const usdcAmount = BigInt(Math.floor(parsedDeposit * 1e6));

      // Check allowance
      const currentAllowance = await readContract({
        contract: usdcContract,
        method: 'function allowance(address owner, address spender) view returns (uint256)',
        params: [account.address, CONTRACTS.shieldVault],
      });

      if (currentAllowance < usdcAmount) {
        setTxStatus('approving');
        console.log('[PRISM] Approving USDC for ShieldVault...');
        const approveData = iface.encodeFunctionData('approve', [CONTRACTS.shieldVault, usdcAmount]);
        const approveHash = await sendDirectTx(account.address, CONTRACTS.mockUSDC, approveData);
        await waitForReceipt(approveHash);
        console.log('[PRISM] USDC approved');
      }

      setTxStatus('depositing');
      console.log('[PRISM] Depositing to ShieldVault...');
      const depositData = iface.encodeFunctionData('deposit', [usdcAmount]);
      const depositHash = await sendDirectTx(account.address, CONTRACTS.shieldVault, depositData);
      console.log('[PRISM] deposit tx:', depositHash);
      await waitForReceipt(depositHash);
      console.log('[PRISM] Deposit confirmed!');

      setTxStatus('success');
      setStep(2);
      setTimeout(() => setTxStatus('idle'), 1500);
    } catch (err: any) {
      console.error('Deposit failed:', err);
      setTxStatus('error');
      const msg = err?.reason || err?.data?.message || err?.message || 'Transaction failed';
      setErrorMsg(typeof msg === 'string' ? msg.slice(0, 150) : 'Transaction failed');
      setTimeout(() => setTxStatus('idle'), 5000);
    } finally {
      busyRef.current = false;
    }
  }, [account, parsedDeposit]);

  // ── Step 4: Activate Shield ───────────────────────────────────────────────
  const handleActivate = useCallback(async () => {
    if (!account || busyRef.current) return;
    busyRef.current = true;
    setErrorMsg('');

    const iface = new ethers.utils.Interface([
      'function activateShield(address protocol)',
    ]);

    try {
      setTxStatus('activating');
      console.log('[PRISM] Activating shield...');
      const data = iface.encodeFunctionData('activateShield', [AAVE_V3_POOL]);
      const hash = await sendDirectTx(account.address, CONTRACTS.shieldVault, data);
      console.log('[PRISM] activateShield tx:', hash);
      await waitForReceipt(hash);
      console.log('[PRISM] Shield activated!');

      setTxStatus('success');
      onSuccess();
      setTimeout(() => setTxStatus('idle'), 4000);
    } catch (err: any) {
      console.error('Activate failed:', err);
      setTxStatus('error');
      const msg = err?.reason || err?.data?.message || err?.message || 'Transaction failed';
      setErrorMsg(typeof msg === 'string' ? msg.slice(0, 150) : 'Transaction failed');
      setTimeout(() => setTxStatus('idle'), 5000);
    } finally {
      busyRef.current = false;
    }
  }, [account, onSuccess]);

  const isBusy = txStatus === 'approving' || txStatus === 'depositing' || txStatus === 'activating';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-gray-800/50 rounded-2xl p-8 border border-gray-700 text-center">
        <div className="text-6xl mb-4">&#x1F6E1;&#xFE0F;</div>
        <h2 className="text-2xl font-bold mb-2">Activate Shield Mode</h2>
        <p className="text-gray-400">
          Protect your DeFi position with PRISM insurance. Deposit USDC and activate your shield.
        </p>
      </div>

      {!account && (
        <div className="text-center py-4 text-gray-400 text-sm bg-gray-900/30 rounded-lg border border-gray-700">
          Connect your wallet to activate shield protection
        </div>
      )}

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
              disabled={parsedDeposit <= 0 || isBusy || !account}
              className={`w-full py-3 rounded-lg font-semibold transition-all ${
                isBusy
                  ? 'bg-gray-600 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500'
              }`}
            >
              {txStatus === 'approving'
                ? 'Approving USDC... (sign in wallet)'
                : txStatus === 'depositing'
                  ? 'Depositing... (sign in wallet)'
                  : 'Deposit USDC'}
            </button>
            {txStatus === 'approving' && (
              <div className="flex items-center justify-center space-x-2 text-sm text-blue-400">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span>Step 1/2: Approve USDC in your wallet...</span>
              </div>
            )}
            {txStatus === 'depositing' && (
              <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <span>Step 2/2: Confirm deposit in your wallet...</span>
              </div>
            )}
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
            {worldIdLoading ? (
              <div className="text-sm text-gray-400">Checking verification status...</div>
            ) : isWorldIdVerified ? (
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-green-400">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span>World ID verified — required for shield activation</span>
                </div>
                <button
                  onClick={() => setStep(3)}
                  className="w-full py-2.5 bg-green-600 hover:bg-green-700 rounded-lg font-medium text-sm transition-colors"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-red-400">
                  <div className="w-2 h-2 rounded-full bg-red-400"></div>
                  <span>World ID verification is required to activate shield</span>
                </div>
                <p className="text-sm text-gray-400">
                  You must be World ID verified before activating shield protection.
                  The contract will reject activation without verification.
                </p>
                <button
                  onClick={() => setStep(3)}
                  className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium text-sm transition-colors"
                >
                  Continue Anyway (will fail at activation)
                </button>
              </div>
            )}
          </div>
        )}
        {step > 2 && (
          <div className={`p-5 text-sm ${isWorldIdVerified ? 'text-green-400' : 'text-yellow-400'}`}>
            {isWorldIdVerified ? 'Verified' : 'Not verified — activation may fail'}
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
                <span>{premiumRate}% (= current risk price)</span>
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
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Protected Protocol</span>
                <span className="font-mono">Aave v3</span>
              </div>
              <div className="border-t border-gray-700 pt-3 flex justify-between font-semibold">
                <span>Deposit After Premium</span>
                <span>${(parsedDeposit - premiumCost).toFixed(2)} USDC</span>
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
          <div className="p-5 space-y-3">
            <button
              onClick={handleActivate}
              disabled={isBusy || !account}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                txStatus === 'activating'
                  ? 'bg-gray-600 cursor-wait'
                  : txStatus === 'success'
                    ? 'bg-green-600'
                    : txStatus === 'error'
                      ? 'bg-red-600'
                      : 'bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500'
              }`}
            >
              {txStatus === 'activating'
                ? 'Activating Shield... (sign in wallet)'
                : txStatus === 'success'
                  ? 'Shield Activated!'
                  : txStatus === 'error'
                    ? 'Activation Failed'
                    : 'Activate Shield Mode'}
            </button>
            {txStatus === 'activating' && (
              <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                <span>Confirm activation in your wallet...</span>
              </div>
            )}
            {txStatus === 'success' && (
              <div className="flex items-center justify-center space-x-2 text-sm text-green-400">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span>Shield is now active — your position is protected!</span>
              </div>
            )}
            {txStatus === 'error' && errorMsg && (
              <div className="text-center text-sm text-red-400 break-words">{errorMsg}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ShieldPage() {
  const account = useActiveAccount();
  const [refreshKey, setRefreshKey] = useState(0);
  const riskMarket = useRiskMarket(refreshKey);
  const shieldVault = useShieldVault(account?.address, refreshKey);

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
          premiumPaid={shieldVault.premiumPaid}
          protectedProtocol={shieldVault.protectedProtocol}
          securedAmount={shieldVault.securedAmount}
          onDeactivateSuccess={() => setRefreshKey(k => k + 1)}
        />
      ) : (
        <ShieldActivation
          zone={riskMarket.zone}
          riskPrice={riskMarket.price}
          onSuccess={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
}
