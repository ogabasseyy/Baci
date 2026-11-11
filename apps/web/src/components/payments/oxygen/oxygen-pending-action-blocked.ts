import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { isLegacyOfferRecoveryQueued } from './oxygen-legacy-offer-recovery-queued';

export function oxygenPendingActionBlocked(
  snapshot: OxygenRuntimeSnapshot,
  action: string
): boolean {
  const pending = snapshot.pending;
  if (!pending) return false;
  if (
    action === 'refresh_eligibility' &&
    ['approve_booking', 'trigger_approval_otp', 'book'].includes(pending.action)
  )
    return !isLegacyOfferRecoveryQueued(snapshot);
  return (
    pending.status === 'queued' &&
    pending.action !== action &&
    !(
      pending.action === 'validate_customer' && action === 'resend_customer_otp'
    )
  );
}
