import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResolvedCheckoutPage } from './resolved-checkout-page';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Complete your private storefront checkout securely.',
  robots: { index: false, follow: false },
};

export default function CheckoutPage(
  props: Parameters<typeof ResolvedCheckoutPage>[0]
) {
  return (
    <Suspense fallback={<main role="status">Loading secure checkout…</main>}>
      <ResolvedCheckoutPage {...props} />
    </Suspense>
  );
}
