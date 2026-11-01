import { oxygenEligibilityPrerequisites } from '@/lib/payments/oxygen/eligibility-prerequisites';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenApplicationError } from './OxygenApplicationError';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { oxygenRateLimitMessage } from './use-oxygen-provider';

/** Retry only the failed read check; uncertain financial commands remain untouched. */
export function OxygenWorkflowError({
  snapshot,
  action,
  activeLoan,
  error,
  merchantSlug,
  busy,
  submit,
  refresh,
}: {
  snapshot: OxygenRuntimeSnapshot | null;
  action: OxygenRuntimeAction['action'] | null;
  activeLoan: boolean;
  error: string;
  merchantSlug?: string;
  busy: boolean;
  submit: SubmitOxygenForm;
  refresh: () => Promise<unknown>;
}) {
  const retryEligibility = Boolean(
    !activeLoan &&
      action === 'refresh_eligibility' &&
      error !== oxygenRateLimitMessage &&
      snapshot?.executionEnabled &&
      !snapshot.pending &&
      !snapshot.state.bookingReference &&
      snapshot.state.eligible !== true &&
      ['eligibility_required', 'kyc_required'].includes(snapshot.stage) &&
      oxygenEligibilityPrerequisites(snapshot.state)
  );
  const retryBreakdown = action === 'refresh_details' && !snapshot?.pending;
  return (
    <OxygenApplicationError
      activeLoan={activeLoan}
      action={action}
      retryBreakdown={retryBreakdown}
      retryEligibility={retryEligibility}
      error={error}
      validated={snapshot?.state.validated}
      stage={snapshot?.stage}
      merchantSlug={merchantSlug}
      busy={busy}
      refresh={
        retryEligibility
          ? () => submit({ action: 'refresh_eligibility' })
          : retryBreakdown
            ? () => submit({ action: 'refresh_details' })
            : refresh
      }
    />
  );
}
