import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

/** Only these pending read commands may be resumed by a customer status check. */
export function pendingReadRecovery(
  snapshot: OxygenRuntimeSnapshot | null
): 'refresh_kyc' | 'refresh_details' | null {
  const pending = snapshot?.pending;
  if (
    !snapshot?.executionEnabled ||
    !snapshot.state.bookingReference ||
    (pending?.status !== 'queued' && pending?.status !== 'executing')
  )
    return null;
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
