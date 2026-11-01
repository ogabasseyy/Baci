'use client';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';
import type { OxygenCheckoutProduct } from './OxygenProductSummary';
import { useOxygenPaymentConfirmation } from './use-oxygen-payment-confirmation';

export function OxygenPaymentCompletion({
  reference,
  plan,
  products,
  active,
  busy,
  readSaved,
}: {
  reference: string;
  plan?: OxygenProviderState;
  products?: OxygenCheckoutProduct[];
  active: boolean;
  busy: boolean;
  readSaved?: () => Promise<void>;
}) {
  useOxygenPaymentConfirmation(active, busy, readSaved);
  return (
    <OxygenPaymentSuccess
      reference={reference}
      plan={plan}
      products={products}
    />
  );
}
