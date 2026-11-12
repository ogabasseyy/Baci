/**
 * Decides which PiggyVest degraded-health alerts to raise from aggregate
 * counts only (no ids, no customer data). Pure: the runtime reads the counts
 * and rate-limits; this only applies the thresholds.
 */
export const DEGRADED_TRANSFER_THRESHOLD = 3;
/** A goal-wallet setup older than this (seconds) counts as stalled. */
export const DEGRADED_STALE_AFTER_SECONDS = 600;

export type DegradedReason =
  | 'goal_wallet_setup_stalled'
  | 'transfers_indeterminate';

export interface DegradedCounts {
  /** Goal-wallet setups not finished after the stale cutoff; null = unread. */
  stalledGoalWallets: number | null;
  /** Savings transfers still reserved or sent after the stale cutoff. */
  indeterminateTransfers: number | null;
}

export interface DegradedAlert {
  reason: DegradedReason;
  attempts: number;
}

export function decideDegradedAlerts(counts: DegradedCounts): DegradedAlert[] {
  const alerts: DegradedAlert[] = [];
  const { stalledGoalWallets: wallets, indeterminateTransfers: transfers } =
    counts;
  if (Number.isSafeInteger(wallets) && (wallets as number) >= 1)
    alerts.push({
      reason: 'goal_wallet_setup_stalled',
      attempts: wallets as number,
    });
  if (
    Number.isSafeInteger(transfers) &&
    (transfers as number) >= DEGRADED_TRANSFER_THRESHOLD
  )
    alerts.push({
      reason: 'transfers_indeterminate',
      attempts: transfers as number,
    });
  return alerts;
}
