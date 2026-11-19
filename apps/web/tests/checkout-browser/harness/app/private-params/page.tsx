'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { usePrivateSearchParams } from '@/hooks/use-private-search-params';

function PrivateParamsFixture() {
  const params = usePrivateSearchParams();
  const live = useSearchParams();
  return (
    <main>
      <h1>Private params fixture</h1>
      <p>Token: {params.get('token') ?? 'none'}</p>
      <p>Order: {params.get('orderId') ?? 'none'}</p>
      <p>Router query: {live.toString() || 'empty'}</p>
      <a href="#main">Skip to main content</a>
      <div id="main" />
    </main>
  );
}

export default function PrivateParamsPage() {
  return (
    <Suspense fallback={null}>
      <PrivateParamsFixture />
    </Suspense>
  );
}
