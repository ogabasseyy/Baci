import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

/** Completing keeps the interest: everything in the goal moves to the wallet. */
export function goalCompleteBreakdown(goal: WalletActiveSavingsGoal) {
  const total = goal.current_amount;
  // Without the stored balance the interest split (and so the exact amount
  // PiggyVest moves) is unknown: show no figures rather than guess.
  const known = goal.principal_amount !== undefined;
  const saved = Math.min(goal.principal_amount ?? total, total);
  return { known, saved, interest: Math.max(0, total - saved), total };
}
