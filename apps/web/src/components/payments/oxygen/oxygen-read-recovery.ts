import { oxygenEligibilityPrerequisites } from '@/lib/payments/oxygen/eligibility-prerequisites';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

/** Identify pending commands safe for an explicit customer action. */
export function pendingReadRecovery(
  snapshot: OxygenRuntimeSnapshot | null
):
  | 'refresh_kyc'
  | 'refresh_details'
  | 'refresh_eligibility'
  | 'refresh_payment_setup'
  | 'validate_nin'
  | 'selfie_link'
  | 'book'
  | 'trigger_approval_otp'
  | 'submit_address'
  | null {
  const pending = snapshot?.pending;
  if (
    !snapshot?.executionEnabled ||
    (pending?.status !== 'queued' && pending?.status !== 'executing')
  )
    return null;
  // A queued address upload needs a new proof and a separate retirement step.
  if (
    pending.action === 'submit_address' &&
    pending.status === 'queued' &&
    snapshot.stage === 'booked' &&
    snapshot.state.bookingReference &&
    snapshot.state.booking?.status === 'BOOKED' &&
    snapshot.state.kyc?.address_status === 'NOT_DONE'
  )
    return 'submit_address';
  // A queued command has not been dispatched; resuming it must reuse its key.
  if (
    pending.action === 'trigger_approval_otp' &&
    pending.status === 'queued' &&
    snapshot.stage === 'approval_required' &&
    snapshot.state.bookingReference &&
    snapshot.state.kyc?.address_status === 'DONE'
  )
    return 'trigger_approval_otp';
  if (
    pending.action === 'book' &&
    pending.status === 'queued' &&
    pending.bookingTerms &&
    !snapshot.bookingBlock &&
    !snapshot.approvalOtpReady &&
    snapshot.stage !== 'activated' &&
    snapshot.stage !== 'reconciliation_required'
  )
    return 'book';
  if (
    pending.action === 'selfie_link' &&
    pending.status === 'queued' &&
    snapshot.state.applicationReference &&
    snapshot.state.validated &&
    !snapshot.state.bookingReference &&
    snapshot.stage !== 'activated' &&
    snapshot.stage !== 'reconciliation_required'
  )
    return 'selfie_link';
  if (
    pending.action === 'validate_nin' &&
    pending.status === 'queued' &&
    snapshot.state.applicationReference &&
    !snapshot.state.bookingReference &&
    snapshot.stage !== 'activated' &&
    snapshot.stage !== 'reconciliation_required'
  )
    return 'validate_nin';
  if (
    pending.action === 'refresh_eligibility' &&
    pending.status === 'queued' &&
    ['booked', 'approval_required'].includes(snapshot.stage) &&
    snapshot.state.applicationReference &&
    snapshot.state.bookingReference &&
    snapshot.state.booking?.status === 'BOOKED' &&
    !snapshot.state.offers &&
    !snapshot.state.paymentComplete &&
    !snapshot.state.setupComplete &&
    oxygenEligibilityPrerequisites(snapshot.state)
  )
    return 'refresh_eligibility';
  if (
    pending.action === 'refresh_eligibility' &&
    ['eligibility_required', 'kyc_required'].includes(snapshot.stage) &&
    snapshot.state.applicationReference &&
    snapshot.state.eligible === undefined &&
    !snapshot.state.bookingReference &&
    oxygenEligibilityPrerequisites(snapshot.state)
  )
    return 'refresh_eligibility';
  if (
    pending.action === 'refresh_kyc' &&
    snapshot.state.applicationReference &&
    snapshot.stage !== 'activated' &&
    snapshot.stage !== 'reconciliation_required'
  )
    return 'refresh_kyc';
  if (!snapshot.state.bookingReference) return null;
  if (
    pending.action === 'refresh_payment_setup' &&
    ['payment_required', 'ready_for_activation'].includes(snapshot.stage)
  )
    return 'refresh_payment_setup';
  if (
    pending.action === 'refresh_details' &&
    (snapshot.stage === 'booked' || snapshot.stage === 'approval_required')
  )
    return 'refresh_details';
  return null;
}

/** Keep uncertain and non-resumable queued mutations on the status screen. */
export function awaitingOxygenConfirmation(
  snapshot: OxygenRuntimeSnapshot | null
): boolean {
  return Boolean(
    snapshot?.stage === 'reconciliation_required' ||
      pendingReadRecovery(snapshot) ||
      (snapshot?.pending?.status === 'queued' &&
        ['submit_address', 'trigger_approval_otp'].includes(
          snapshot.pending.action
        )) ||
      ['indeterminate', 'executing'].includes(snapshot?.pending?.status ?? '')
  );
}
