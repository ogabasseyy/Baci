'use client';

import { useState } from 'react';
import { checkoutStyles } from '@/components/storefront/shared/checkout-theme';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  OxygenCheckoutAdapter,
  OxygenHostedStep,
} from '@/lib/payments/oxygen/checkout';
import { OxygenPlanReview } from './OxygenPlanReview';
import {
  OxygenRepaymentBreakdown,
  oxygenCheckoutMoney,
} from './OxygenRepaymentBreakdown';
import { useOxygenCheckout } from './use-oxygen-checkout';

const button = `min-h-11 rounded-lg border px-4 py-3 text-sm font-medium disabled:opacity-40 ${checkoutStyles.outlineButton}`;
export function OxygenCheckoutFlow({
  adapter,
}: {
  adapter: OxygenCheckoutAdapter;
}) {
  const flow = useOxygenCheckout(adapter);
  const [hosted, setHosted] = useState<{
    step: OxygenHostedStep;
    bookingReference: string;
  } | null>(null);
  const { snapshot, busy, error } = flow;
  const complete = snapshot?.phase === 'simulation_complete';
  const hostedStep =
    snapshot && hosted?.bookingReference === snapshot.bookingReference
      ? hosted.step
      : null;
  function returnToCheckout() {
    setHosted(null);
    void flow.check();
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-5 text-gray-900 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Oxygen · checkout preview
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Pay in instalments
        </h1>
        <p className="mt-2 text-gray-600">
          Review your plan and complete the upfront steps.
        </p>
      </header>
      <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Simulation mode.</strong> No real payment is collected and no
        loan is activated.
      </aside>
      <ol
        aria-label="Checkout progress"
        className="flex flex-wrap gap-4 text-sm text-gray-600"
      >
        {['Review plan', 'Payment and setup', 'Confirmation'].map(
          (label, index) => {
            const current = complete
              ? 2
              : snapshot?.phase === 'approved'
                ? 1
                : 0;
            return (
              <li
                key={label}
                aria-current={current === index ? 'step' : undefined}
                className={
                  current === index ? 'font-semibold text-gray-950' : ''
                }
              >
                {index + 1}. {label}
              </li>
            );
          }
        )}
      </ol>
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-900"
        >
          {error}
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm text-gray-600">
          Checking your plan…
        </p>
      )}
      {!snapshot && !busy && (
        <button
          type="button"
          className={button}
          onClick={() => void flow.reload()}
        >
          Try again
        </button>
      )}
      {snapshot && (
        <>
          <OxygenRepaymentBreakdown quote={snapshot.quote} />
          {snapshot.phase === 'booked' && (
            <OxygenPlanReview
              key={snapshot.bookingReference}
              percentage={snapshot.quote.equityPercentage}
              busy={busy}
              onReplace={(percentage) => void flow.replace(percentage)}
              onAccept={() => void flow.accept()}
            />
          )}
          {snapshot.phase === 'approved' && (
            <section
              aria-label="Payment and setup"
              className="space-y-4 rounded-xl border bg-white p-5"
            >
              <h2 className="text-lg font-semibold">
                Complete both upfront steps
              </h2>
              <ul aria-live="polite" className="space-y-2 text-sm">
                <li>
                  {snapshot.paymentComplete
                    ? 'Payment completed'
                    : 'Payment pending'}
                </li>
                <li>
                  {snapshot.setupComplete
                    ? 'Repayment setup completed'
                    : 'Repayment setup pending'}
                </li>
              </ul>
              <div className="flex flex-wrap gap-3">
                {!snapshot.paymentComplete && (
                  <button
                    type="button"
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      setHosted({
                        step: 'payment',
                        bookingReference: snapshot.bookingReference,
                      })
                    }
                  >
                    Open payment
                  </button>
                )}
                {!snapshot.setupComplete && (
                  <button
                    type="button"
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      setHosted({
                        step: 'setup',
                        bookingReference: snapshot.bookingReference,
                      })
                    }
                  >
                    Open repayment setup
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  className={button}
                  onClick={() => void flow.check()}
                >
                  Check payment status
                </button>
                {!snapshot.paymentComplete && (
                  <button
                    type="button"
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      void flow.replace(snapshot.quote.equityPercentage)
                    }
                  >
                    Change plan
                  </button>
                )}
              </div>
              <button
                type="button"
                disabled={
                  busy || !snapshot.paymentComplete || !snapshot.setupComplete
                }
                onClick={() => void flow.confirm()}
                className={`min-h-11 rounded-lg px-5 py-3 font-medium disabled:opacity-40 ${checkoutStyles.primaryButton}`}
              >
                Confirm simulation
              </button>
            </section>
          )}
          {complete && (
            <section
              role="status"
              className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-5 text-green-950"
            >
              <h2 className="text-xl font-semibold">Simulation complete</h2>
              <p>
                In the live checkout, Oxygen sends your offer letter to your
                email address.
              </p>
              <p className="text-sm">
                No real activation or merchant settlement was performed.
              </p>
            </section>
          )}
        </>
      )}
      <Dialog
        open={hostedStep !== null}
        onOpenChange={(open) => {
          if (!open) returnToCheckout();
        }}
      >
        <DialogContent>
          <DialogTitle>
            {hostedStep === 'payment'
              ? 'Simulated payment'
              : 'Simulated repayment setup'}
          </DialogTitle>
          <DialogDescription>
            This preview replaces Oxygen’s hosted page. It cannot collect money
            or set up a debit mandate.
          </DialogDescription>
          {hostedStep === 'payment' && snapshot && (
            <p className="text-2xl font-semibold">
              {oxygenCheckoutMoney(snapshot.quote.upfrontMinor)}
            </p>
          )}
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              const step = hostedStep;
              setHosted(null);
              if (step) void flow.completeHosted(step);
            }}
          >
            {hostedStep === 'payment'
              ? 'Simulate successful payment'
              : 'Simulate successful setup'}
          </button>
          <button type="button" className={button} onClick={returnToCheckout}>
            Return without completing
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
