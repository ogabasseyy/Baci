'use client';

import { type ComponentProps, lazy, Suspense } from 'react';
import { CryptoSelectorModalLoadingFallback } from './CryptoSelectorModalLoadingFallback';

const LazyModal = lazy(() =>
  import('./CryptoSelectorModal').then((module) => ({ default: module.CryptoSelectorModal }))
);

export function DeferredCryptoSelectorModal(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<CryptoSelectorModalLoadingFallback />}>
      <LazyModal {...props} />
    </Suspense>
  );
}
