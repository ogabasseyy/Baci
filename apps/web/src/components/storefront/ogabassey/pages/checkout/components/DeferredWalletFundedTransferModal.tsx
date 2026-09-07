'use client';

import { type ComponentProps, lazy, Suspense } from 'react';

const LazyModal = lazy(() =>
  import('./WalletFundedTransferModal').then((module) => ({ default: module.WalletFundedTransferModal }))
);

export function DeferredWalletFundedTransferModal(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<span role="status">Loading dialog…</span>}>
      <LazyModal {...props} />
    </Suspense>
  );
}
