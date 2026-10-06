import { REDEEMABLE_SAVINGS_STATUSES } from '@/lib/checkout-savings';
import type { WalletSavingsInterestResponse } from '@/schemas/wallet-savings-interest';
import { coerceWalletDatabaseNumber } from './wallet-data-number';

type SavingsGoalRow = Record<string, unknown> & {
  id?: unknown;
  status?: unknown;
  current_amount?: unknown;
};

export function addWalletCurrencyAmounts(left: number, right: number): number {
  return Math.round((left + right + Number.EPSILON) * 100) / 100;
}

export function projectWalletSavingsInterest<T extends SavingsGoalRow>({
  goals,
  goalInterestKobo,
}: {
  goals: readonly T[];
  goalInterestKobo: WalletSavingsInterestResponse['goal_interest_kobo'];
}): {
  goals: (T & { current_amount?: unknown })[];
  savingsBalance: number;
  appliedInterestKobo: number;
} {
  const interestByGoalId = new Map(
    goalInterestKobo.map((entry) => [
      entry.goal_id,
      entry.credited_interest_kobo,
    ])
  );
  let savingsBalance = 0;
  let appliedInterestKobo = 0;
  const projectedGoals = goals.map((goal) => {
    const currentAmount = coerceWalletDatabaseNumber(goal.current_amount);
    const interestKobo =
      typeof goal.id === 'string' &&
      typeof goal.status === 'string' &&
      REDEEMABLE_SAVINGS_STATUSES.includes(
        goal.status as (typeof REDEEMABLE_SAVINGS_STATUSES)[number]
      )
        ? (interestByGoalId.get(goal.id) ?? 0)
        : 0;
    if (interestKobo > 0 && currentAmount !== null) {
      appliedInterestKobo += interestKobo;
      const projected = {
        ...goal,
        current_amount: addWalletCurrencyAmounts(
          currentAmount,
          interestKobo / 100
        ),
      };
      savingsBalance = addWalletCurrencyAmounts(
        savingsBalance,
        projected.current_amount as number
      );
      return projected;
    }
    savingsBalance = addWalletCurrencyAmounts(
      savingsBalance,
      currentAmount ?? 0
    );
    return goal;
  });

  return { goals: projectedGoals, savingsBalance, appliedInterestKobo };
}
