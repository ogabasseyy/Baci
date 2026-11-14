import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

/**
 * A funded goal is marked completed by the database as soon as funding reaches
 * the target, before the completion operation moves its balance out. Settling
 * zeroes the stored balance (`principal_amount`, else `current_amount`), so "completed but still holding money" is a goal
 * the customer can still complete. Callers must also require a ready
 * PiggyVest main wallet: a legacy completed goal looks the same.
 */
export function isFundedUnsettledGoal(
  goal: WalletActiveSavingsGoal | null | undefined
): boolean {
  if (goal?.status !== 'completed') return false;
  // `current_amount` includes projected interest already credited; settlement
  // moves only the stored balance, so judge that.
  return (goal.principal_amount ?? goal.current_amount) > 0;
}
