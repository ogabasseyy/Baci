'use client';

import { type ComponentProps, lazy, Suspense } from 'react';

const LazyModal = lazy(() =>
  import('./WalletTransferConsentDialog').then((module) => ({ default: module.WalletTransferConsentDialog }))
);

export function DeferredWalletTransferConsentDialog(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<span role="status">Loading dialog…</span>}>
      <LazyModal {...props} />
    </Suspense>
  );
}
