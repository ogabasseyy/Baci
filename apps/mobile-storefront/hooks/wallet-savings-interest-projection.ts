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
  goalInterestKnown = false,
}: {
  goals: readonly T[];
  goalInterestKobo: WalletSavingsInterestResponse['goal_interest_kobo'];
  /**
   * The server reported per-goal interest: a goal with none has its stored
   * balance as its exact principal, so the review can show the full split.
   */
  goalInterestKnown?: boolean;
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
        // The stored balance before the interest projection: whether a goal
        // still holds money to settle must not count interest already paid.
        principal_amount: currentAmount,
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
    // No interest credited, and the server said so: the stored balance is
    // the exact principal (interest is never added to it).
    if (goalInterestKnown && currentAmount !== null)
      return { ...goal, principal_amount: currentAmount };
    return goal;
  });

  return { goals: projectedGoals, savingsBalance, appliedInterestKobo };
}
