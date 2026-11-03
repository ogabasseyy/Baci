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
  | null {
  const pending = snapshot?.pending;
  if (
    !snapshot?.executionEnabled ||
    (pending?.status !== 'queued' && pending?.status !== 'executing')
  )
    return null;
  // A queued command has not been dispatched; resuming it must reuse its key.
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
