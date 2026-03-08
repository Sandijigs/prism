'use client';
import dynamic from 'next/dynamic';

const PortfolioPage = dynamic(() => import('./PortfolioClient'), { ssr: false });

export default function Page() {
  return <PortfolioPage />;
}
