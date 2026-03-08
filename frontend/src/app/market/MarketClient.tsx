'use client';

import { useRiskMarket } from '@/hooks/useContracts';
import { getRiskMarketContract, getMockUSDCContract, useIsVerified } from '@/hooks/usePRISMContracts';
import { CONTRACTS, client, chain } from '@/lib/thirdweb';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useActiveAccount, useActiveWalletChain, useReadContract } from 'thirdweb/react';
import { getContract, readContract } from 'thirdweb';
import { ethers } from 'ethers';

type TradeTab = 'buy' | 'sell';
type TxStatus = 'idle' | 'approving' | 'trading' | 'success' | 'error';

const CHAIN_NAMES: Record<number, string> = {
  73571: 'Tenderly VTN',
  11155111: 'Sepolia',
  1: 'Ethereum',
};

function useNetworkName(): string {
  const walletChain = useActiveWalletChain();
  if (walletChain?.id) return CHAIN_NAMES[walletChain.id] || `Chain ${walletChain.id}`;
  const configuredId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '73571');
  return CHAIN_NAMES[configuredId] || `Chain ${configuredId}`;
}

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

// ── Thirdweb contract instances for reads ───────────────────────────────────

const usdcContract = getContract({ client, chain, address: CONTRACTS.mockUSDC });
const riskMarketContract = getContract({ client, chain, address: CONTRACTS.riskMarket });

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

// Send transaction directly to Tenderly admin RPC (bypasses wallet + thirdweb proxy)
async function sendDirectTx(
  from: string,
  to: string,
  data: string,
): Promise<string> {
  const txHash = await rpcCall('eth_sendTransaction', [{
    from,
    to,
    data,
    gas: '0x100000', // 1M gas — plenty for any PRISM contract call
  }]);
  return txHash;
}

// ── Components ──────────────────────────────────────────────────────────────

function MarketHeader({ price, zone, totalRisk, totalUsdc, networkName }: {
  price: number;
  zone: string;
  totalRisk: string;
  totalUsdc: string;
  networkName: string;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <div className="text-sm text-gray-400 mb-1">Risk Price</div>
        <div className="text-3xl font-bold">{price.toFixed(2)}%</div>
        <div className="text-sm text-green-400 mt-1">Live from {networkName}</div>
      </div>
      <div className={`rounded-xl p-5 border ${ZONE_BG[zone] || ZONE_BG.Green}`}>
        <div className="text-sm text-gray-400 mb-1">Risk Zone</div>
        <div className={`text-3xl font-bold ${ZONE_COLORS[zone] || ZONE_COLORS.Green}`}>{zone}</div>
        <div className="text-sm text-gray-400 mt-1">
          {zone === 'Green' ? '< 5%' : zone === 'Yellow' ? '5-15%' : zone === 'Orange' ? '15-35%' : '> 35%'}
        </div>
      </div>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <div className="text-sm text-gray-400 mb-1">USDC Pool</div>
        <div className="text-3xl font-bold">${parseFloat(totalUsdc).toFixed(2)}</div>
        <div className="text-sm text-gray-400 mt-1">AMM reserve</div>
      </div>
      <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <div className="text-sm text-gray-400 mb-1">RISK Pool</div>
        <div className="text-3xl font-bold">{parseFloat(totalRisk).toFixed(2)}</div>
        <div className="text-sm text-gray-400 mt-1">AMM reserve</div>
      </div>
    </div>
  );
}

function TradingPanel({ price, networkName, onTradeSuccess }: { price: number; networkName: string; onTradeSuccess?: () => void }) {
  const account = useActiveAccount();
  const [tab, setTab] = useState<TradeTab>('buy');
  const [amount, setAmount] = useState('');
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const busyRef = useRef(false); // prevents double-execution (MetaMask double-prompt → disconnect)

  const parsedAmount = parseFloat(amount) || 0;
  const priceDecimal = price / 100;
  const estimatedOutput = tab === 'buy'
    ? parsedAmount > 0 && priceDecimal > 0 ? (parsedAmount / priceDecimal).toFixed(2) : '0.00'
    : parsedAmount > 0 ? (parsedAmount * priceDecimal).toFixed(2) : '0.00';

  // ── Buy flow ──────────────────────────────────────────────────────────────
  // Sends directly to Tenderly admin RPC (bypasses thirdweb proxy which
  // 404s on custom chain 73571). Reads still use thirdweb hooks.
  const handleBuy = useCallback(async () => {
    if (!account || parsedAmount <= 0 || busyRef.current) return;
    busyRef.current = true;
    setErrorMsg('');

    const iface = new ethers.utils.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function buyRisk(uint256 usdcAmount) returns (uint256)',
    ]);

    try {
      const usdcAmount = BigInt(Math.floor(parsedAmount * 1e6));

      // Check allowance via thirdweb readContract
      const currentAllowance = await readContract({
        contract: usdcContract,
        method: 'function allowance(address owner, address spender) view returns (uint256)',
        params: [account.address, CONTRACTS.riskMarket],
      });

      if (currentAllowance < usdcAmount) {
        setTxStatus('approving');
        const approveData = iface.encodeFunctionData('approve', [CONTRACTS.riskMarket, usdcAmount]);
        const approveHash = await sendDirectTx(account.address, CONTRACTS.mockUSDC, approveData);
        console.log('[PRISM] Approve tx:', approveHash);
        await waitForReceipt(approveHash);
      }

      setTxStatus('trading');
      const buyData = iface.encodeFunctionData('buyRisk', [usdcAmount]);
      console.log('[PRISM] Sending buyRisk tx...');
      const buyHash = await sendDirectTx(account.address, CONTRACTS.riskMarket, buyData);
      console.log('[PRISM] Tx broadcast, hash:', buyHash);
      await waitForReceipt(buyHash);
      console.log('[PRISM] Tx confirmed on-chain!');

      setTxStatus('success');
      setAmount('');
      onTradeSuccess?.();
      setTimeout(() => setTxStatus('idle'), 4000);
    } catch (err: any) {
      console.error('Buy failed:', err);
      setTxStatus('error');
      const msg = err?.reason || err?.data?.message || err?.message || 'Transaction failed';
      setErrorMsg(typeof msg === 'string' ? msg.slice(0, 150) : 'Transaction failed');
      setTimeout(() => setTxStatus('idle'), 5000);
    } finally {
      busyRef.current = false;
    }
  }, [account, parsedAmount]);

  // ── Sell flow ─────────────────────────────────────────────────────────────
  const handleSell = useCallback(async () => {
    if (!account || parsedAmount <= 0 || busyRef.current) return;
    busyRef.current = true;
    setErrorMsg('');

    const iface = new ethers.utils.Interface([
      'function sellRisk(uint256 riskAmount) returns (uint256)',
    ]);

    try {
      setTxStatus('trading');
      const riskAmount = BigInt(Math.floor(parsedAmount * 1e18));
      const sellData = iface.encodeFunctionData('sellRisk', [riskAmount]);
      const sellHash = await sendDirectTx(account.address, CONTRACTS.riskMarket, sellData);
      await waitForReceipt(sellHash);

      setTxStatus('success');
      setAmount('');
      onTradeSuccess?.();
      setTimeout(() => setTxStatus('idle'), 4000);
    } catch (err: any) {
      console.error('Sell failed:', err);
      setTxStatus('error');
      const msg = err?.reason || err?.data?.message || err?.message || 'Transaction failed';
      setErrorMsg(typeof msg === 'string' ? msg.slice(0, 150) : 'Transaction failed');
      setTimeout(() => setTxStatus('idle'), 5000);
    } finally {
      busyRef.current = false;
    }
  }, [account, parsedAmount]);

  const handleTrade = () => {
    if (tab === 'buy') handleBuy();
    else handleSell();
  };

  const isBusy = txStatus === 'approving' || txStatus === 'trading';
  const isDisabled = parsedAmount <= 0 || isBusy || !account;

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
        {!account && (
          <div className="text-center py-4 text-gray-400 text-sm bg-gray-900/30 rounded-lg">
            Connect your wallet to trade
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-2">
            {tab === 'buy' ? 'Amount (USDC)' : 'Amount (RISK tokens)'}
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-blue-500 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              {tab === 'buy' ? 'USDC' : 'RISK'}
            </span>
          </div>
          {tab === 'buy' && parsedAmount > 0 && parsedAmount < 1 && (
            <div className="text-xs text-yellow-400 mt-1">Minimum trade: 1 USDC</div>
          )}
        </div>

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
            <span className="text-gray-400">Network</span>
            <span className="text-white">{networkName}</span>
          </div>
        </div>

        <button
          onClick={handleTrade}
          disabled={isDisabled}
          className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
            isBusy
              ? 'bg-gray-600 cursor-wait'
              : txStatus === 'success'
                ? 'bg-green-600'
                : txStatus === 'error'
                  ? 'bg-red-600'
                  : tab === 'buy'
                    ? 'bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500'
                    : 'bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500'
          }`}
        >
          {!account
            ? 'Connect Wallet'
            : txStatus === 'approving'
              ? 'Approving USDC... (sign in wallet)'
              : txStatus === 'trading'
                ? 'Executing Trade... (sign in wallet)'
                : txStatus === 'success'
                  ? 'Trade Successful!'
                  : txStatus === 'error'
                    ? 'Trade Failed'
                    : `Execute ${tab === 'buy' ? 'Buy' : 'Sell'}`}
        </button>

        {txStatus === 'approving' && (
          <div className="flex items-center justify-center space-x-2 text-sm text-blue-400">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>Step 1/2: Approve USDC in your wallet...</span>
          </div>
        )}
        {txStatus === 'trading' && (
          <div className="flex items-center justify-center space-x-2 text-sm text-yellow-400">
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span>{tab === 'buy' ? 'Step 2/2: Confirm buy' : 'Confirm sell'} in your wallet...</span>
          </div>
        )}
        {txStatus === 'success' && (
          <div className="flex items-center justify-center space-x-2 text-sm text-green-400">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span>Transaction confirmed!</span>
          </div>
        )}
        {txStatus === 'error' && errorMsg && (
          <div className="text-center text-sm text-red-400 break-words">{errorMsg}</div>
        )}
      </div>
    </div>
  );
}

function UserPosition({ price, address, refreshTrigger = 0 }: { price: number; address?: string; refreshTrigger?: number }) {
  const contract = getRiskMarketContract();
  const { data: riskBalanceRaw, refetch } = useReadContract({
    contract,
    method: 'function riskBalances(address) view returns (uint256)',
    params: [address || '0x0000000000000000000000000000000000000000'],
  });

  // Re-fetch when a trade completes
  useEffect(() => {
    if (refreshTrigger > 0) refetch();
  }, [refreshTrigger, refetch]);

  const riskBalance = riskBalanceRaw ? Number(riskBalanceRaw) / 1e18 : 0;
  const currentValue = riskBalance * (price / 100);

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Your Position</h3>
      {!address ? (
        <div className="text-sm text-gray-400">Connect wallet to see position</div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-400">RISK Balance</span>
            <span className="font-medium">{riskBalance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Current Price</span>
            <span className="font-medium">{price.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Current Value</span>
            <span className="font-medium">${currentValue.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function WorldIdBadge({ address }: { address?: string }) {
  const { data: isVerified, isLoading } = useIsVerified(address);

  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">World ID</h3>
      {!address ? (
        <div className="text-sm text-gray-400">Connect wallet to check status</div>
      ) : isLoading ? (
        <div className="text-sm text-gray-400">Checking verification...</div>
      ) : isVerified ? (
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
  const [refreshKey, setRefreshKey] = useState(0);
  const riskMarket = useRiskMarket(refreshKey);
  const account = useActiveAccount();
  const networkName = useNetworkName();

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
        networkName={networkName}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <TradingPanel price={riskMarket.price} networkName={networkName} onTradeSuccess={() => setRefreshKey(k => k + 1)} />
        </div>
        <div className="space-y-6">
          <UserPosition price={riskMarket.price} address={account?.address} refreshTrigger={refreshKey} />
          <WorldIdBadge address={account?.address} />
        </div>
      </div>
    </div>
  );
}
