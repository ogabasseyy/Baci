'use client';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import { OxygenHostedPayment } from './OxygenHostedPayment';
import { OxygenPaymentCompletion } from './OxygenPaymentCompletion';
import {
  type OxygenCheckoutProduct,
  OxygenProductSummary,
} from './OxygenProductSummary';
import { oxygenButtonClass } from './oxygen-checkout-styles';
import { useOxygenPaymentRecovery } from './use-oxygen-payment-recovery';
export function OxygenPaymentRecovery({
  workflowId,
  reference,
  version,
  approvalUnconfirmed = false,
  autoOpen = false,
  previousStep,
  planState,
  products,
  statusError = false,
  onCheckStatus,
  active = true,
  parentBusy = false,
  readSaved,
}: {
  workflowId: string;
  reference: string;
  version: number;
  approvalUnconfirmed?: boolean;
  autoOpen?: boolean;
  previousStep?: ReactNode;
  planState?: OxygenProviderState;
  products?: OxygenCheckoutProduct[];
  statusError?: boolean;
  onCheckStatus?: () => void;
  active?: boolean;
  parentBusy?: boolean;
  readSaved?: () => Promise<void>;
}) {
  const [showPreviousStep, setShowPreviousStep] = useState(false);
  const {
    state,
    busy,
    error,
    paymentUrl,
    closePayment,
    checkStatus,
    run,
    awaitingConfirmation,
    confirmationDelayed,
  } = useOxygenPaymentRecovery(workflowId, reference, version);
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || !state || state.pending || busy || error || opened.current)
      return;
    opened.current = true;
    void run('check_status', true);
  }, [autoOpen, state, busy, error, run]);
  const paymentDone = state?.paymentComplete === true;
  const setupDone = state?.setupComplete === true;
  const waiting = busy;
  const statusOnly = Boolean(
    awaitingConfirmation ||
      error ||
      statusError ||
      state?.pending ||
      state?.resendBlocked ||
      (state?.lastOutcome != null && state.lastOutcome !== 'succeeded') ||
      state?.paymentComplete === null
  );
  const showingPrevious = showPreviousStep && !(paymentDone && setupDone);
  if (paymentDone && setupDone && !state?.pending)
    return (
      <OxygenPaymentCompletion
        reference={reference}
        plan={planState}
        products={products}
        active={active}
        busy={parentBusy || busy}
        readSaved={readSaved}
      />
    );
  return (
    <section
      aria-label="Payment recovery"
      className="space-y-5 rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-50/60 to-white p-5 sm:p-6"
    >
      {products?.length ? <OxygenProductSummary products={products} /> : null}
      {showingPrevious && previousStep}
      <div className="space-y-2" hidden={showingPrevious}>
        <p className="text-xs font-semibold uppercase tracking-wider text-red-600">
          Your payment plan
        </p>
        <h3 className="text-xl font-bold text-gray-900">
          {statusOnly
            ? 'Your saved payment plan'
            : paymentDone && setupDone
              ? 'Your upfront steps are complete'
              : paymentDone
                ? 'Set up your repayments'
                : 'Complete your upfront payment'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-600">
          {statusOnly
            ? 'Your plan is saved. Check your payment status to continue.'
            : paymentDone && setupDone
              ? 'Your payment and repayment setup have been confirmed by Oxygen.'
              : 'Your plan is saved. Continue securely with Oxygen. We’ll confirm your payment automatically when you return.'}
        </p>
      </div>
      {planState?.booking?.status === 'APPROVED' && !showingPrevious && (
        <>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Plan approved · Signature completed
          </p>
          <OxygenComparisonSummary state={planState} loading={false} compact />
        </>
      )}
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
      {statusOnly && (
        <p role="status" className="text-sm text-amber-800">
          {confirmationDelayed || error || statusError
            ? 'Payment is not confirmed yet. Check its status before trying to pay again.'
            : busy
              ? 'Checking securely with Oxygen…'
              : 'Check with Oxygen before continuing your payment.'}
        </p>
      )}
      {!(paymentDone && setupDone) && (
        <button
          type="button"
          disabled={waiting || (!state && !error)}
          onClick={() => {
            if (statusOnly) {
              onCheckStatus?.();
              void checkStatus();
            } else void run('check_status', true);
          }}
          className={`${oxygenButtonClass} w-full`}
        >
          {busy
            ? statusOnly
              ? 'Checking payment…'
              : 'Opening payment…'
            : statusOnly
              ? 'Check payment status'
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
