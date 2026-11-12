/**
 * Decides which PiggyVest degraded-health alerts to raise from aggregate
 * counts only (no ids, no customer data). Pure: the runtime reads the counts
 * and rate-limits; this only applies the threshold.
 *
 * Today it watches stuck savings transfers only. A "goal-wallet setup
 * stalled" reason needs a read-only aggregate over goal_wallet_intents that
 * the evidence login cannot read yet; it is a follow-up, not shipped dark.
 */
export const DEGRADED_TRANSFER_THRESHOLD = 3;
/** A transfer still in flight after this many seconds counts as stuck. */
export const DEGRADED_STALE_AFTER_SECONDS = 600;

export type DegradedReason = 'transfers_indeterminate';

export interface DegradedCounts {
  /** Savings transfers still reserved or sent after the stale cutoff. */
  indeterminateTransfers: number | null;
}

export interface DegradedAlert {
  reason: DegradedReason;
  attempts: number;
}

export function decideDegradedAlerts(counts: DegradedCounts): DegradedAlert[] {
  const transfers = counts.indeterminateTransfers;
  if (
    typeof transfers === 'number' &&
    Number.isSafeInteger(transfers) &&
    transfers >= DEGRADED_TRANSFER_THRESHOLD
  )
    return [{ reason: 'transfers_indeterminate', attempts: transfers }];
  return [];
}
