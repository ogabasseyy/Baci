'use client';

import { ArrowLeft, Check } from 'lucide-react';
import { useState } from 'react';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import { OxygenSavedPlans } from './OxygenSavedPlans';
import { oxygenButtonClass } from './oxygen-checkout-styles';

/** Reviewing a quote is local navigation, never provider approval. */
export function OxygenBookedPlanReview({
  workflowId,
  state,
  busy,
  onAccept,
}: {
  workflowId: string;
  state: OxygenProviderState;
  busy: boolean;
  onAccept: (reference: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <OxygenSavedPlans
        workflowId={workflowId}
        state={state}
        approvalBusy={busy}
        onAccept={onAccept}
      />
    );
  const ready = Boolean(
    state.bookingReference &&
      state.booking &&
      state.schedule?.length &&
      (state.booking.total_charges != null || state.quotedCharges != null)
  );
  return (
    <section className="grid gap-5" aria-label="Review payment breakdown">
      <header className="pr-10">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-store-primary">
          <Check size={18} aria-hidden="true" /> Your payment plan
        </p>
        <h3 className="text-xl font-bold text-gray-900">
          Your payment breakdown
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          Here’s your confirmed breakdown from Oxygen. Check the amounts and
          payment dates before continuing.
        </p>
      </header>
      <OxygenComparisonSummary state={state} loading={!ready} />
      <div className="grid gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          className={oxygenButtonClass}
          disabled={busy || !ready}
          onClick={() => {
            if (state.bookingReference) onAccept(state.bookingReference);
          }}
        >
          Accept payment plan
        </button>
        <button
          type="button"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-store-primary"
          disabled={busy || !ready}
          onClick={() => setEditing(true)}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Change down payment or repayment period
        </button>
      </div>
    </section>
  );
}
