import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

export function getSavingsProgress(goal: WalletActiveSavingsGoal) {
  const progress =
    goal.target_amount > 0
      ? Math.min(1, Math.max(0, goal.current_amount / goal.target_amount))
      : 0;
  const milestone =
    progress >= 0.75
      ? 'Almost there'
      : progress >= 0.5
        ? 'Halfway to your device'
        : progress > 0
          ? 'Your plan is growing'
          : 'Your plan is ready';

  return { milestone, percent: Math.round(progress * 100) };
}
