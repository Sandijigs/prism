import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'PRISM Protocol - Intelligent Risk Markets',
  description: 'Protect your DeFi positions with autonomous, AI-powered risk assessment and insurance',
};

function ConnectButton() {
  return (
    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
      Connect Wallet
    </button>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">
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
                <ConnectButton />
              </div>
            </div>
          </nav>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
