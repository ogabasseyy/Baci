import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

/**
 * What an early cancel does with the goal's money (owner rule, 2026-11-12):
 * the saved amount goes back to the main wallet; interest is not refunded.
 */
export function goalCancelBreakdown(goal: WalletActiveSavingsGoal) {
  const balance = goal.current_amount;
  // Without the stored balance the split between savings and interest is
  // unknown: say so instead of implying the whole balance comes back.
  const known = goal.principal_amount !== undefined || balance <= 0;
  const saved = Math.min(goal.principal_amount ?? balance, balance);
  return {
    known,
    saved,
    forfeited: Math.max(0, balance - saved),
    refund: saved,
  };
}
