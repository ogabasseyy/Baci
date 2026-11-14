/**
 * Decides which PiggyVest degraded-health alerts to raise from aggregate
 * counts only (no ids, no customer data). Pure: the runtime reads the counts
 * and rate-limits; this only applies the thresholds.
 *
 * It watches two things: savings transfers stuck in flight, and goal-wallet
 * setups that never reached "enrolled".
 */
export const DEGRADED_TRANSFER_THRESHOLD = 3;
export const DEGRADED_GOAL_WALLET_THRESHOLD = 3;
/** A transfer or setup still unfinished after this many seconds is stuck. */
export const DEGRADED_STALE_AFTER_SECONDS = 600;

export type DegradedReason =
  | 'transfers_indeterminate'
  | 'goal_wallet_setup_stalled';

export interface DegradedCounts {
  /** Savings transfers still reserved or sent after the stale cutoff. */
  indeterminateTransfers: number | null;
  /** Goal-wallet setups not enrolled after the stale cutoff. */
  stalledGoalWallets: number | null;
}

export interface DegradedAlert {
  reason: DegradedReason;
  attempts: number;
}

function reaches(count: number | null, threshold: number): count is number {
  return (
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= threshold
  );
}

export function decideDegradedAlerts(counts: DegradedCounts): DegradedAlert[] {
  const alerts: DegradedAlert[] = [];
  const { indeterminateTransfers: transfers, stalledGoalWallets: wallets } =
    counts;
  if (reaches(transfers, DEGRADED_TRANSFER_THRESHOLD))
    alerts.push({ reason: 'transfers_indeterminate', attempts: transfers });
  if (reaches(wallets, DEGRADED_GOAL_WALLET_THRESHOLD))
    alerts.push({ reason: 'goal_wallet_setup_stalled', attempts: wallets });
  return alerts;
}
