import { oxygenEligibilityPrerequisites } from '@/lib/payments/oxygen/eligibility-prerequisites';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

/** Only safe pending commands may be resumed by a customer status check. */
export function pendingReadRecovery(
  snapshot: OxygenRuntimeSnapshot | null
):
  | 'refresh_kyc'
  | 'refresh_details'
  | 'refresh_eligibility'
  | 'refresh_payment_setup'
  | null {
  const pending = snapshot?.pending;
  if (
    !snapshot?.executionEnabled ||
    (pending?.status !== 'queued' && pending?.status !== 'executing')
  )
    return null;
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
  if (!snapshot.state.bookingReference) return null;
  if (
    pending.action === 'refresh_payment_setup' &&
    ['payment_required', 'ready_for_activation'].includes(snapshot.stage)
  )
    return 'refresh_payment_setup';
  if (
    pending.action === 'refresh_kyc' &&
    snapshot.stage === 'booked' &&
    snapshot.state.kyc?.address_status === 'PROCESSING'
  )
    return 'refresh_kyc';
  if (
    pending.action === 'refresh_details' &&
    (snapshot.stage === 'booked' || snapshot.stage === 'approval_required')
  )
    return 'refresh_details';
  return null;
}
