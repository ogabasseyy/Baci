'use client';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';
import type { OxygenCheckoutProduct } from './OxygenProductSummary';
import { oxygenButtonClass } from './oxygen-checkout-styles';
import { useOxygenPaymentConfirmation } from './use-oxygen-payment-confirmation';

export function OxygenPaymentCompletion({
  reference,
  plan,
  products,
  active,
  busy,
  readSaved,
  checkStatus,
  error,
}: {
  reference: string;
  plan?: OxygenProviderState;
  products?: OxygenCheckoutProduct[];
  active: boolean;
  busy: boolean;
  readSaved?: () => Promise<void>;
  checkStatus?: () => Promise<void>;
  error?: string;
}) {
  useOxygenPaymentConfirmation(active, busy, readSaved);
  return (
    <>
      <OxygenPaymentSuccess
        reference={reference}
        plan={plan}
        products={products}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          We could not confirm your order yet. Your payment is saved; please try
          again.
        </p>
      )}
      {checkStatus && (
        <button
          type="button"
          className={`${oxygenButtonClass} w-full`}
          disabled={busy || !active}
          onClick={() =>
            void (async () => {
              await checkStatus();
              try {
                await readSaved?.();
              } catch {
                // The saved-state poll will try again.
              }
            })()
          }
        >
          {busy ? 'Checking order confirmation…' : 'Check order confirmation'}
        </button>
      )}
    </>
  );
}
