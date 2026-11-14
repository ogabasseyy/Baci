import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';

interface SavingsSuccessInput {
  amount: number;
  goal: Pick<
    WalletActiveSavingsGoal,
    'current_amount' | 'target_amount' | 'title'
  >;
  goalCompleted: boolean;
  /** The app's own guess says this top-up may have finished the goal. */
  mayHaveCompleted?: boolean;
  refreshFailed: boolean;
  /**
   * The goal balance the server reported after this contribution. Preferred
   * over the client snapshot, which may already include a replayed amount.
   */
  savedAfter?: number;
}

const REFRESH_HINT = ' Pull to refresh your latest balance.';

/**
 * Builds the encouraging message shown only after the server has confirmed
 * a contribution. Progress comes from the confirmed amount, never from a
 * balance change observed on screen.
 */
export function buildSavingsSuccessMessage({
  amount,
  goal,
  goalCompleted,
  mayHaveCompleted = false,
  refreshFailed,
  savedAfter,
}: SavingsSuccessInput): { message: string; title: string } {
  const added = formatNgnCurrency(amount);
  const hint = refreshFailed ? REFRESH_HINT : '';
  // The server's own post-contribution balance reaching the target counts as
  // completed too, so a goal-reaching top-up never says "keep it going".
  const reachedTarget =
    savedAfter !== undefined &&
    Number.isFinite(savedAfter) &&
    goal.target_amount > 0 &&
    savedAfter >= goal.target_amount;
  if (goalCompleted || reachedTarget) {
    return {
      message: `You added ${added} and reached your ${goal.title} goal. Amazing work!${hint}`,
      title: 'Goal reached! 🎉',
    };
  }
  const confirmedSaved =
    savedAfter !== undefined && Number.isFinite(savedAfter) ? savedAfter : null;
  // Progress is shown only from the server's own post-contribution balance:
  // a client snapshot can be stale or already include a replayed amount.
  const percent =
    confirmedSaved !== null && goal.target_amount > 0
      ? Math.min(
          99,
          Math.max(1, Math.floor((confirmedSaved / goal.target_amount) * 100))
        )
      : null;
  // Without the server's balance, a top-up that may have finished the goal
  // gets plain wording instead of "keep it going".
  if (percent === null && mayHaveCompleted) {
    return {
      message: `Nice! ${added} added to your ${goal.title}.${hint}`,
      title: 'Savings updated',
    };
  }
  const progress =
    percent === null
      ? `Every naira gets you closer to your ${goal.title}. Keep it going!`
      : `You're ${percent}% of the way to your ${goal.title}. Keep it going!`;
  return {
    message: `Nice! ${added} added. ${progress}${hint}`,
    title: 'Savings updated',
  };
}
