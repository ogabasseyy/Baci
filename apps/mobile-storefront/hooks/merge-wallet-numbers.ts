import { mergeSavingsHistory } from './merge-savings-history';
import type { WalletNumbers } from './wallet-number.types';
import type { WalletActiveSavingsGoal, WalletQueryData } from './wallet-query';

export function mergeWalletNumbers(
  cached: WalletQueryData,
  fresh: WalletNumbers | null
): WalletQueryData | null {
  if (!fresh) return null;
  const goals = cached.wallet.savings_goals ?? [];
  const amounts = new Map(fresh.goals.map((goal) => [goal.id, goal]));
  const matches = (goal: WalletActiveSavingsGoal) => {
    const latest = amounts.get(goal.id);
    return (
      latest?.status === goal.status &&
      latest.target_amount === goal.target_amount &&
      cached.goalMetadata?.[goal.id] === latest.metadata
    );
  };
  const active = cached.wallet.active_savings_goal;
  if (
    goals.length !== amounts.size ||
    !goals.every(matches) ||
    (active && !matches(active))
  )
    return null;
  const updateGoal = (
    goal: WalletActiveSavingsGoal
  ): WalletActiveSavingsGoal => ({
    ...goal,
    current_amount: amounts.get(goal.id)?.current_amount ?? goal.current_amount,
  });
  return {
    ...cached,
    transactions: mergeSavingsHistory(
      cached.transactions,
      fresh.interestTransactions
    ),
    wallet: {
      ...cached.wallet,
      ...fresh.wallet,
      savings_goals: goals.map(updateGoal),
      active_savings_goal: active ? updateGoal(active) : active,
    },
  };
}
