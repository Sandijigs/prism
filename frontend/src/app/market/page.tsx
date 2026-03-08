'use client';
import dynamic from 'next/dynamic';

const MarketPage = dynamic(() => import('./MarketClient'), { ssr: false });

export default function Page() {
  return <MarketPage />;
}
