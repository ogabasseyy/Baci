'use client';
import { useEffect, useRef, useState } from 'react';
import { oxygenPaymentRecoveryStateSchema } from '@/schemas/oxygen-payment-recovery';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import styles from './OxygenApplicationDialog.module.css';
import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';

const reference = '70000000-0000-4000-8000-000000000001';
const response = oxygenPaymentRecoveryStateSchema.parse({
  reference,
  paymentComplete: true,
  setupComplete: true,
  paymentUrl: null,
  setupUrl: null,
  checkedAt: '2026-10-25T06:00:00Z',
  lastOutcome: 'succeeded',
  pending: false,
  resendBlocked: false,
});
const plan: OxygenProviderState = {
  bookingReference: reference,
  booking: {
    loan_reference: reference,
    product_amount: 396000,
    equity_percentage: 25,
    equity_amount: 99000,
    loan_amount: 297000,
    loan_tenure: 6,
    status: 'BOOKED',
    total_charges: 5865.75,
    total_upfront_payment: 104865.75,
  },
  schedule: Array.from({ length: 6 }, (_, index) => ({
    period: index + 1,
    dueDate: [
      index < 2 ? 2026 : 2027,
      index < 2 ? 11 + index : index - 1,
      27,
    ] as [number, number, number],
    amount: index === 5 ? 61830.89 : 61829,
    principal: 0,
    interest: 0,
  })),
};
// Fixed fixture only. No API calls, credentials, storage writes or booking mutations.
export function OxygenPaymentSuccessPreview() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <main className="min-h-dvh bg-gray-50 p-6 text-gray-900">
      <h1 className="text-xl font-bold">Ogabassey checkout · UI preview</h1>
      <p className="mt-2 text-sm text-gray-600">
        A fixed mocked response is used here. The real booking is unchanged.
      </p>
      <button
        type="button"
        className="mt-6 min-h-11 rounded-xl bg-red-600 px-5 text-white"
        onClick={() => setOpen(true)}
      >
        Reopen mocked success screen
      </button>
      <dialog
        ref={dialog}
        aria-label="Mocked payment success preview"
        className={styles.dialog}
        onClose={() => setOpen(false)}
      >
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3 text-center text-xs font-semibold text-amber-900">
          MOCKED PREVIEW · No payment was made
        </div>
        <div className={`${styles.body} p-4 sm:p-6`}>
          {response.paymentComplete && response.setupComplete && (
            <OxygenPaymentSuccess
              reference={response.reference}
              plan={plan}
              products={[
                {
                  id: 'mock-galaxy-a16',
                  name: 'Samsung Galaxy A16 LTE',
                  quantity: 2,
                  price: 198000,
                },
              ]}
              onDone={() => dialog.current?.close()}
            />
          )}
        </div>
      </dialog>
    </main>
  );
}
