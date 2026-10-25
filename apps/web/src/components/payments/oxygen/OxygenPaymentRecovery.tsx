'use client';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { type ReactNode, useContext, useState } from 'react';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenHostedPayment } from './OxygenHostedPayment';
import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';
import { OxygenCheckoutCloseContext } from './OxygenPaymentSurfaceContext';
import type { OxygenCheckoutProduct } from './OxygenProductSummary';
import { useOxygenPaymentRecovery } from './use-oxygen-payment-recovery';
export function OxygenPaymentRecovery({
  workflowId,
  reference,
  version,
  approvalUnconfirmed = false,
  previousStep,
  planState,
  products,
}: {
  workflowId: string;
  reference: string;
  version: number;
  approvalUnconfirmed?: boolean;
  previousStep?: ReactNode;
  planState?: OxygenProviderState;
  products?: OxygenCheckoutProduct[];
}) {
  const [showPreviousStep, setShowPreviousStep] = useState(false);
  const {
    state,
    busy,
    error,
    paymentUrl,
    closePayment,
    run,
    awaitingConfirmation,
    confirmationDelayed,
  } = useOxygenPaymentRecovery(workflowId, reference, version);
  const closeCheckout = useContext(OxygenCheckoutCloseContext);
  const paymentDone = state?.paymentComplete === true;
  const setupDone = state?.setupComplete === true;
  const waiting = busy;
  const showingPrevious = showPreviousStep && !(paymentDone && setupDone);
  if (paymentDone && setupDone && !state?.pending)
    return (
      <OxygenPaymentSuccess
        reference={reference}
        plan={planState}
        products={products}
        onDone={closeCheckout}
      />
    );
  return (
    <section
      aria-label="Payment recovery"
      className="space-y-5 rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-50/60 to-white p-5 sm:p-6"
    >
      {showingPrevious && previousStep}
      <div className="space-y-2" hidden={showingPrevious}>
        <p className="text-xs font-semibold uppercase tracking-wider text-red-600">
          Your payment plan
        </p>
        <h3 className="text-xl font-bold text-gray-900">
          {awaitingConfirmation
            ? confirmationDelayed
              ? 'Waiting for payment confirmation'
              : 'Confirming your payment…'
            : paymentDone && setupDone
              ? 'Your upfront steps are complete'
              : paymentDone
                ? 'Set up your repayments'
                : 'Complete your upfront payment'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-600">
          {awaitingConfirmation
            ? 'Your plan is saved. You can close this checkout and return later while we wait for confirmation.'
            : paymentDone && setupDone
              ? 'Your payment and repayment setup have been confirmed by Oxygen.'
              : 'Your plan is saved. Continue securely with Oxygen. We’ll confirm your payment automatically when you return.'}
        </p>
      </div>
      <div
        className="flex flex-wrap gap-2 text-xs font-medium"
        hidden={showingPrevious}
      >
        {setupDone && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-2 text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Repayment setup complete
          </span>
        )}
        {paymentDone && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-2 text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Upfront payment confirmed
          </span>
        )}
        {state?.paymentComplete === false && !awaitingConfirmation && (
          <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-800">
            Upfront payment remaining
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {state?.resendBlocked && (
        <p role="status" className="text-sm text-amber-800">
          We’re waiting for Oxygen to confirm your last request. Your plan is
          saved.
        </p>
      )}
      {state?.pending && (
        <p role="status" className="text-sm text-amber-800">
          Oxygen is processing your last request. Your plan is saved.
        </p>
      )}
      {awaitingConfirmation && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-amber-800"
        >
          {!confirmationDelayed && (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
            />
          )}
          {confirmationDelayed
            ? 'Confirmation is taking longer than expected. Please do not pay again.'
            : 'Checking securely with Oxygen…'}
        </p>
      )}
      {!(paymentDone && setupDone) && !awaitingConfirmation && (
        <button
          type="button"
          disabled={waiting || (!state && !error)}
          onClick={() => void run('check_status', true)}
          className="flex min-h-11 w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? 'Please wait…'
            : paymentDone
              ? 'Set up repayments'
              : 'Continue to payment'}
        </button>
      )}
      {paymentUrl && (
        <OxygenHostedPayment url={paymentUrl} onClose={closePayment} />
      )}
      {previousStep && !showPreviousStep && (
        <button
          type="button"
          className="min-h-11 text-sm font-medium text-red-700 underline underline-offset-4"
          onClick={() => setShowPreviousStep(true)}
        >
          View plan and verification
        </button>
      )}
      {approvalUnconfirmed && (
        <p className="border-t border-rose-100 pt-4 text-xs leading-relaxed text-gray-500">
          Payment progress is saved separately while the earlier approval
          confirmation is being reconciled.
        </p>
      )}
    </section>
  );
}
