'use client';

import { CircleCheck } from 'lucide-react';
import { useContext, useEffect } from 'react';
import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';
import {
  type OxygenCheckoutProduct,
  OxygenProductSummary,
} from './OxygenProductSummary';

/** Only mounted for the authenticated canonical activated workflow. No provider requests. */
export function OxygenCompletedApplication({
  products,
}: {
  products?: OxygenCheckoutProduct[];
}) {
  const onConfirmed = useContext(OxygenOrderConfirmationContext);
  useEffect(() => {
    onConfirmed?.();
  }, [onConfirmed]);
  return (
    <section
      className="space-y-5 px-6 pb-6 text-center"
      aria-label="Completed Oxygen application"
    >
      <CircleCheck
        aria-hidden="true"
        className="mx-auto size-12 text-emerald-700"
      />
      <h3 className="text-2xl font-bold">Payment plan confirmed</h3>
      <p>Your upfront payment is confirmed and your payment plan is active.</p>
      {products?.length ? <OxygenProductSummary products={products} /> : null}
    </section>
  );
}
