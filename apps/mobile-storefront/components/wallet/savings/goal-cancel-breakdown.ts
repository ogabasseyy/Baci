import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

/**
 * What an early cancel does with the goal's money (owner rule, 2026-11-12):
 * the saved amount goes back to the main wallet; interest is not refunded.
 */
export function goalCancelBreakdown(goal: WalletActiveSavingsGoal) {
  const balance = goal.current_amount;
  // Without the stored balance the split between savings and interest is
  // unknown: say so instead of implying the whole balance comes back.
  // A missing or null principal both mean "unknown" (as in the Complete step).
  const principal = goal.principal_amount ?? undefined;
  const known = principal !== undefined || balance <= 0;
  const saved = Math.min(principal ?? balance, balance);
  return {
    known,
    saved,
    forfeited: Math.max(0, balance - saved),
    refund: saved,
  };
}
