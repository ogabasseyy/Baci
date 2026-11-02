'use client';
import { useRef, useState } from 'react';
import {
  oxygenActiveLoanMessage,
  oxygenStatementRequiredMessage,
} from '@/lib/payments/oxygen/booking-rejection';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import { oxygenCheckFailureTitle } from './oxygen-check-failure-title';
import { oxygenButtonClass as button } from './oxygen-checkout-styles';
import { oxygenRateLimitMessage } from './use-oxygen-provider';

type Props = {
  activeLoan: boolean;
  action?: OxygenRuntimeAction['action'] | null;
  retryBreakdown?: boolean;
  retryEligibility?: boolean;
  error: string;
  validated?: boolean;
  stage?: string;
  merchantSlug?: string;
  busy: boolean;
  refresh: () => Promise<unknown>;
};

/** Static customer recovery copy; provider diagnostic bodies remain private. */
export function OxygenApplicationError({
  activeLoan,
  action,
  retryBreakdown = false,
  retryEligibility = false,
  error,
  validated,
  stage,
  merchantSlug,
  busy,
  refresh,
}: Props) {
  const [retrying, setRetrying] = useState(false);
  const locked = useRef(false);
  async function retry() {
    if (busy || locked.current) return;
    locked.current = true;
    setRetrying(true);
    try {
      await refresh();
    } catch {
      // Keep the saved recovery screen available; never retry automatically.
    } finally {
      locked.current = false;
      setRetrying(false);
    }
  }
  return (
    <div className="mx-auto grid max-w-md gap-4 rounded-2xl bg-gray-50 p-6 text-center">
      {(validated || activeLoan) && (
        <h3 className="text-xl font-bold text-gray-900">
          {activeLoan
            ? 'You already have an active Oxygen loan'
            : retryEligibility
              ? 'We couldn’t finish checking your payment options'
              : stage === 'plan_required'
                ? 'We couldn’t prepare your payment plan'
                : oxygenCheckFailureTitle(action)}
        </h3>
      )}
      <p role="alert" className="text-sm leading-relaxed text-gray-600">
        {activeLoan
          ? oxygenActiveLoanMessage
          : error === oxygenRateLimitMessage ||
              error === oxygenStatementRequiredMessage
            ? error
            : retryEligibility
              ? 'Oxygen is taking longer than expected. Your details and verification are saved. Try again to continue.'
              : 'We couldn’t complete this step right now. Your progress is saved.'}
      </p>
      {activeLoan ? (
        merchantSlug ? (
          <a className={button} href={`/${merchantSlug}/contact`}>
            Contact support
          </a>
        ) : null
      ) : (
        <button
          className={button}
          type="button"
          disabled={busy || retrying}
          aria-busy={busy || retrying}
          onClick={() => void retry()}
        >
          {retryEligibility
            ? busy || retrying
              ? 'Checking your payment options…'
              : 'Try again'
            : retryBreakdown
              ? 'Retry payment breakdown'
              : 'Check for an update'}
        </button>
      )}
    </div>
  );
}
