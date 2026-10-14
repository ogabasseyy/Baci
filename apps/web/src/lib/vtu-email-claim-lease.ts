/**
 * Customer email-claim lease expiry (receipt vs token states).
 *
 * Extracted from `vtu-fulfillment.ts` per the 300-line Boy Scout
 * Rule (Codex R95 P1): the email-claim leasing responsibility this
 * PR added to the already-oversized fulfillment module lives here;
 * the pre-existing receipt/token key constants and state readers
 * stay with their callers.
 */
import { CUSTOMER_EMAIL_NOTIFICATION_CLAIM_LEASE_MS } from '@/lib/vtu-metadata-fields';

export interface CustomerEmailNotificationState {
  attemptedKey: string;
  legacySentKeys?: readonly string[];
  sentKey: string;
  sentWriteKeys?: readonly string[];
}

function getCustomerEmailAttemptedAtKey(state: CustomerEmailNotificationState) {
  return `${state.attemptedKey}At`;
}

export function isCustomerEmailClaimLeaseExpired({
  metadata,
  nowMs = Date.now(),
  state,
}: {
  metadata: Record<string, unknown>;
  nowMs?: number;
  state: CustomerEmailNotificationState;
}) {
  const stamped = metadata[getCustomerEmailAttemptedAtKey(state)];
  if (typeof stamped !== 'string' || stamped.trim() === '') {
    return true;
  }
  const stampedMs = Date.parse(stamped);
  if (!Number.isFinite(stampedMs)) {
    return true;
  }
  // Strict `<`, matching the claim RPC's `attempted_at < cutoff` and
  // the reconciler's `.lt.` arm: all three enforcement points must
  // agree at the boundary (the RPC is the atomic backstop).
  return stampedMs + CUSTOMER_EMAIL_NOTIFICATION_CLAIM_LEASE_MS < nowMs;
}
