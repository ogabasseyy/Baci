import { Suspense } from 'react';
import { OxygenPaymentContent } from './oxygen-payment-content';

export const metadata = {
  title: 'Oxygen payment plan',
  robots: { index: false, follow: false },
};
export default function OxygenPaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  return (
    <Suspense fallback={<p role="status">Loading payment plan…</p>}>
      <OxygenPaymentContent params={params} />
    </Suspense>
  );
}
