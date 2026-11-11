import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { isLegacyApprovalQueued } from './oxygen-legacy-approval-queued';

export function oxygenPendingActionBlocked(
  snapshot: OxygenRuntimeSnapshot,
  action: string
): boolean {
  const pending = snapshot.pending;
  if (!pending) return false;
  if (
    action === 'refresh_eligibility' &&
    ['approve_booking', 'trigger_approval_otp'].includes(pending.action)
  )
    return !isLegacyApprovalQueued(snapshot);
  return (
    pending.status === 'queued' &&
    pending.action !== action &&
    !(
      pending.action === 'validate_customer' && action === 'resend_customer_otp'
    )
  );
}
