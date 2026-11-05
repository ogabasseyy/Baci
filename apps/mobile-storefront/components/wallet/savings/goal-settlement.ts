import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

/**
 * A funded goal is marked completed by the database as soon as funding reaches
 * the target, before the completion operation moves its balance out. Settling
 * zeroes `current_amount`, so "completed but still holding money" is a goal
 * the customer can still complete. Callers must also require a ready
 * PiggyVest main wallet: a legacy completed goal looks the same.
 */
export function isFundedUnsettledGoal(
  goal: WalletActiveSavingsGoal | null | undefined
): boolean {
  return goal?.status === 'completed' && goal.current_amount > 0;
}
