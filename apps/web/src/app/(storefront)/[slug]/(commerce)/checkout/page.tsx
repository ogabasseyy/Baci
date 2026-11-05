import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckoutContent } from './checkout-content';
import CheckoutLoading from './loading';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Complete your private storefront checkout securely.',
  robots: { index: false, follow: false },
};

export default function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ oxygenOrderId?: string }>;
}) {
  return (
    <Suspense fallback={<CheckoutLoading />}>
      <CheckoutContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
