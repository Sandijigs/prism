'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { ConnectButton, useActiveAccount, useActiveWallet, useActiveWalletChain, useDisconnect } from 'thirdweb/react';
import { client, chain, TENDERLY_EXPLORER_URL, EXPLORER_URL } from '../lib/thirdweb';

const CHAIN_NAMES: Record<number, string> = {
  73571: 'Tenderly VTN',
  11155111: 'Sepolia',
  1: 'Ethereum',
};

function WalletConnectButton() {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const walletChain = useActiveWalletChain();
  const { disconnect } = useDisconnect();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const networkName = walletChain?.id
    ? CHAIN_NAMES[walletChain.id] || `Chain ${walletChain.id}`
    : CHAIN_NAMES[parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '73571')] || 'Unknown';

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Not connected — use thirdweb's ConnectButton for the wallet selection modal
  if (!account) {
    return (
      <ConnectButton
        client={client}
        chain={chain}
        connectButton={{
          label: 'Connect Wallet',
          className: 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors',
        }}
      />
    );
  }

  // Connected — custom UI to avoid thirdweb's nested <button> bug
  const shortAddr = `${account.address.slice(0, 6)}...${account.address.slice(-4)}`;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center space-x-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white rounded-lg font-medium transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <span>{shortAddr}</span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showMenu && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="text-xs text-gray-400">Connected Wallet</div>
            <div className="text-sm font-mono text-white mt-1">{shortAddr}</div>
            <div className="text-xs text-green-400 mt-1">{networkName}</div>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(account.address);
              setShowMenu(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Copy Address
          </button>
          <a
            href={TENDERLY_EXPLORER_URL || `${EXPLORER_URL}/address/${account.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            View on Explorer
          </a>
          <button
            onClick={() => {
              if (wallet) disconnect(wallet);
              setShowMenu(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 border-t border-gray-700 transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen flex flex-col">
        <Providers>
          <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-8">
                  <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                    PRISM
                  </Link>
                  <div className="hidden md:flex space-x-6">
                    <Link href="/" className="text-gray-300 hover:text-white transition-colors">
                      Dashboard
                    </Link>
                    <Link href="/market" className="text-gray-300 hover:text-white transition-colors">
                      Market
                    </Link>
                    <Link href="/shield" className="text-gray-300 hover:text-white transition-colors">
                      Shield
                    </Link>
                    <Link href="/portfolio" className="text-gray-300 hover:text-white transition-colors">
                      Portfolio
                    </Link>
                    <Link href="/analytics" className="text-gray-300 hover:text-white transition-colors">
                      Analytics
                    </Link>
                  </div>
                </div>
                <WalletConnectButton />
              </div>
            </div>
          </nav>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
            {children}
          </main>
          <footer className="border-t border-gray-800 bg-gray-900/30 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                <div className="flex items-center space-x-6 text-sm text-gray-400">
                  <span className="flex items-center space-x-2">
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span title="Protected by CRE: Confidential HTTP + Private Transactions">Protected by Chainlink CRE</span>
                  </span>
                  <a
                    href="https://thirdweb.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white transition-colors"
                  >
                    Powered by thirdweb
                  </a>
                  {TENDERLY_EXPLORER_URL && (
                    <a
                      href={TENDERLY_EXPLORER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white transition-colors"
                    >
                      View on Tenderly
                    </a>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  © 2026 PRISM Protocol. Chainlink Convergence Hackathon.
                </div>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
