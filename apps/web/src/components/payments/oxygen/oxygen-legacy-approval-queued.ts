import { oxygenEligibilityPrerequisites } from '@/lib/payments/oxygen/eligibility-prerequisites';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export function isLegacyApprovalQueued(
  snapshot: OxygenRuntimeSnapshot | null
): boolean {
  const pending = snapshot?.pending;
  return Boolean(
    snapshot?.executionEnabled &&
      pending?.status === 'queued' &&
      ['trigger_approval_otp', 'approve_booking'].includes(pending.action) &&
      ['booked', 'approval_required'].includes(snapshot.stage) &&
      snapshot.state.applicationReference &&
      snapshot.state.bookingReference &&
      snapshot.state.booking?.status === 'BOOKED' &&
      !snapshot.state.offers &&
      !snapshot.state.paymentComplete &&
      !snapshot.state.setupComplete &&
      oxygenEligibilityPrerequisites(snapshot.state)
  );
}
