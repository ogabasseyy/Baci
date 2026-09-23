'use client';

import { type ComponentProps, lazy, Suspense } from 'react';
import { CheckoutDeferredModalLoadingFallback } from './CheckoutDeferredModalLoadingFallback';

const LazyModal = lazy(() =>
  import('./CryptoSelectorModal').then((module) => ({ default: module.CryptoSelectorModal }))
);

export function DeferredCryptoSelectorModal(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<CheckoutDeferredModalLoadingFallback />}>
      <LazyModal {...props} />
    </Suspense>
  );
}
