'use client';
import dynamic from 'next/dynamic';

const AnalyticsPage = dynamic(() => import('./AnalyticsClient'), { ssr: false });

export default function Page() {
  return <AnalyticsPage />;
}
