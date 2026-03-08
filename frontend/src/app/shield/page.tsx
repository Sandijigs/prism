'use client';
import dynamic from 'next/dynamic';

const ShieldPage = dynamic(() => import('./ShieldClient'), { ssr: false });

export default function Page() {
  return <ShieldPage />;
}
