'use client';

import { type ComponentProps, lazy, Suspense } from 'react';

const LazyModal = lazy(() =>
  import('@/components/storefront/checkout-auth-modal').then((module) => ({ default: module.CheckoutAuthModal }))
);

export function DeferredCheckoutAuthModal(props: ComponentProps<typeof LazyModal>) {
  return (
    <Suspense fallback={<span role="status">Loading dialog…</span>}>
      <LazyModal {...props} />
    </Suspense>
  );
}
