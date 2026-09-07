'use client';

import { type ComponentProps, lazy, Suspense } from 'react';

const LazyModal = lazy(() =>
  import('./CryptoSelectorModal').then((module) => ({ default: module.CryptoSelectorModal }))
);

export function DeferredCryptoSelectorModal(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<span role="status">Loading dialog…</span>}>
      <LazyModal {...props} />
    </Suspense>
  );
}
