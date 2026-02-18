'use client';

import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { ConnectButton } from 'thirdweb/react';
import { client, chain, TENDERLY_EXPLORER_URL } from '../lib/thirdweb';

function WalletConnectButton() {
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
