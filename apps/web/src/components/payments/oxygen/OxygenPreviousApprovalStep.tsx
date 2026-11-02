'use client';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import { OxygenOtpField } from './OxygenOtpField';

/** Read-only history view. It cannot request or submit another approval. */
export function OxygenPreviousApprovalStep({
  state,
}: {
  state: OxygenProviderState;
}) {
  return (
    <section
      aria-label="Previous plan and verification step"
      className="grid gap-4"
    >
      <OxygenComparisonSummary
        heading="Verify your payment plan"
        state={state}
        loading={false}
        tenure={state.booking?.loan_tenure}
      />
      <OxygenOtpField
        value=""
        onChange={() => {
          /* Historical codes remain read-only. */
        }}
        disabled
        readOnly
        hint="Your code was submitted earlier. Continue to your saved payment step below."
      />
    </section>
  );
}
