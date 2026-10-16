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

export function getCustomerEmailAttemptedAtKey(
  state: CustomerEmailNotificationState
) {
  return `${state.attemptedKey}At`;
}

/**
 * Owned email-claim lease (Codex R97 P2): the stamped generation fences
 * the clear RPC, and the pre-claim values let a stale clearer revert its
 * local claim merge so the settlement merge leaves the owner's lease
 * keys untouched.
 */
export interface CustomerEmailClaimLease {
  generation: string;
  priorAttempted: unknown;
  priorAttemptedAt: unknown;
  /**
   * Pre-claim sent-result keys (Codex R102 P2): a stale clearer must
   * also revert its `sent: false` write — otherwise the settlement
   * merge applies it over the reclaiming owner's newer `true` and
   * the email sends twice.
   */
  priorSent: Array<{ key: string; present: boolean; value: unknown }>;
}

/**
 * Sent-result keys the clear/finalize outcome governs (primary +
 * mirrors). Includes each key's `DeliveryOutcome` marker (Codex R127
 * P2): a stale finalizer must also revert its `unknown` write —
 * otherwise the settlement merge stamps it over the reclaiming
 * owner's lease and the owner's legitimate retry is suppressed.
 */
export function getCustomerEmailSentKeys(
  state: CustomerEmailNotificationState
): string[] {
  const sentKeys = [state.sentKey, ...(state.sentWriteKeys ?? [])];
  return [...sentKeys, ...sentKeys.map((key) => `${key}DeliveryOutcome`)];
}

/**
 * Lease generation the claim RPC stamped (`<attemptedKey>At`): the clear
 * RPC only releases the flag when the row still carries this exact value,
 * so a stale clearer cannot unlock a lease another path reclaimed.
 */
export function getCustomerEmailClaimLeaseGeneration({
  metadata,
  state,
}: {
  metadata: Record<string, unknown>;
  state: CustomerEmailNotificationState;
}): string | null {
  const stamped = metadata[getCustomerEmailAttemptedAtKey(state)];
  return typeof stamped === 'string' && stamped.trim() !== '' ? stamped : null;
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
