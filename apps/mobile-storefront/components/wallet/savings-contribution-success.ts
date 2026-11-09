import { triggerHaptic } from '@/hooks/use-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';

interface SavingsSuccessInput {
  amount: number;
  goal: Pick<
    WalletActiveSavingsGoal,
    'current_amount' | 'target_amount' | 'title'
  >;
  goalCompleted: boolean;
  refreshFailed: boolean;
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
  refreshFailed,
}: SavingsSuccessInput): { message: string; title: string } {
  const added = formatNgnCurrency(amount);
  const hint = refreshFailed ? REFRESH_HINT : '';
  if (goalCompleted) {
    return {
      message: `You added ${added} and reached your ${goal.title} goal. Amazing work!${hint}`,
      title: 'Goal reached! 🎉',
    };
  }
  const saved = goal.current_amount + amount;
  const percent =
    goal.target_amount > 0
      ? Math.min(
          99,
          Math.max(1, Math.floor((saved / goal.target_amount) * 100))
        )
      : null;
  const progress =
    percent === null
      ? 'Keep it going!'
      : `You're ${percent}% of the way to your ${goal.title}. Keep it going!`;
  return {
    message: `Nice! ${added} added. ${progress}${hint}`,
    title: 'Savings updated',
  };
}

/** Success buzz through the shared haptic policy; never blocks saving. */
export function playSavingsSuccessHaptic(): void {
  triggerHaptic('success');
}
