'use client';

import dynamic from 'next/dynamic';

// The dashboard is a single-file React app with all styles inlined.
// We load it client-side only since it uses useState/useEffect/useRef extensively.
const Dashboard = dynamic(() => import('@/components/Dashboard'), { ssr: false });

export default function Home() {
  return <Dashboard />;
}
