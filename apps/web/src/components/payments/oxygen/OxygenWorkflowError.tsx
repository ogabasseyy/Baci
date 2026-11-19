import { oxygenEligibilityPrerequisites } from '@/lib/payments/oxygen/eligibility-prerequisites';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenApplicationError } from './OxygenApplicationError';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { canRefreshSavedOxygenOffers } from './oxygen-offer-refresh';
import { oxygenRateLimitMessage } from './use-oxygen-provider';

/** Retry only the failed read check; uncertain financial commands remain untouched. */
export function OxygenWorkflowError({
  snapshot,
  action,
  safeSelfieRetry = false,
  activeLoan,
  error,
  merchantSlug,
  busy,
  submit,
  refresh,
}: {
  snapshot: OxygenRuntimeSnapshot | null;
  action: OxygenRuntimeAction['action'] | null;
  safeSelfieRetry?: boolean;
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
      oxygenEligibilityPrerequisites(snapshot.state) &&
      (canRefreshSavedOxygenOffers(snapshot) ||
        (!snapshot.state.bookingReference &&
          snapshot.state.eligible !== true &&
          ['eligibility_required', 'kyc_required'].includes(snapshot.stage)))
  );
  const retryNin = Boolean(
    action === 'validate_nin' &&
      snapshot?.executionEnabled &&
      snapshot.ninAttemptStatus === 'safe_retry' &&
      !snapshot.pending
  );
  const retryBreakdown = action === 'refresh_details' && !snapshot?.pending;
  const retrySelfie = Boolean(
    safeSelfieRetry &&
      action === 'selfie_link' &&
      snapshot?.executionEnabled &&
      !snapshot.pending &&
      ['eligibility_required', 'kyc_required'].includes(snapshot.stage)
  );
  return (
    <OxygenApplicationError
      activeLoan={activeLoan}
      action={action}
      retryBreakdown={retryBreakdown}
      retryNin={retryNin}
      retryEligibility={retryEligibility}
      retrySelfie={retrySelfie}
      error={error}
      validated={snapshot?.state.validated}
      stage={snapshot?.stage}
      merchantSlug={merchantSlug}
      busy={busy}
      refresh={
        retrySelfie
          ? () => submit({ action: 'selfie_link' })
          : retryNin
            ? () => submit({ action: 'validate_nin' })
            : retryEligibility
              ? () => submit({ action: 'refresh_eligibility' })
              : retryBreakdown
                ? () => submit({ action: 'refresh_details' })
                : refresh
      }
    />
  );
}
