'use client';

import { type ComponentProps, lazy, Suspense } from 'react';
import { CheckoutDeferredModalLoadingFallback } from './CheckoutDeferredModalLoadingFallback';

const LazyModal = lazy(() =>
  import('./WalletFundedTransferModal').then((module) => ({ default: module.WalletFundedTransferModal }))
);

export function DeferredWalletFundedTransferModal(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<CheckoutDeferredModalLoadingFallback />}>
      <LazyModal {...props} />
    </Suspense>
  );
}
