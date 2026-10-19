import {
  addWalletCurrencyAmounts,
  projectWalletSavingsInterest,
} from './wallet-savings-interest-projection';

const goalId = '10000000-0000-4000-8000-000000000001';

it('adds matching paid interest once to plan progress and savings balance', () => {
  const rawGoals = [{ id: goalId, current_amount: 100, status: 'active' }];
  const result = projectWalletSavingsInterest({
    goals: rawGoals,
    goalInterestKobo: [{ goal_id: goalId, credited_interest_kobo: 733 }],
  });

  expect(result.goals[0].current_amount).toBe(107.33);
  expect(result.savingsBalance).toBe(107.33);
  expect(result.appliedInterestKobo).toBe(733);
  expect(rawGoals[0].current_amount).toBe(100);
  expect(
    projectWalletSavingsInterest({
      goals: rawGoals,
      goalInterestKobo: [{ goal_id: goalId, credited_interest_kobo: 733 }],
    }).goals[0].current_amount
  ).toBe(107.33);
});

it('does not attach archived or unknown goal credits to a visible active goal', () => {
  const result = projectWalletSavingsInterest({
    goals: [
      { id: goalId, current_amount: 100, status: 'active' },
      {
        id: '20000000-0000-4000-8000-000000000002',
        current_amount: 50,
        status: 'archived',
      },
    ],
    goalInterestKobo: [
      {
        goal_id: '30000000-0000-4000-8000-000000000003',
        credited_interest_kobo: 500,
      },
      {
        goal_id: '20000000-0000-4000-8000-000000000002',
        credited_interest_kobo: 200,
      },
    ],
  });

  expect(result.goals[0].current_amount).toBe(100);
  expect(result.goals[1].current_amount).toBe(50);
  expect(result.appliedInterestKobo).toBe(0);
  expect(result.savingsBalance).toBe(150);
});

it('ignores interest for a different goal without changing source rows', () => {
  const rawGoal = { id: goalId, current_amount: '100', status: 'active' };
  const result = projectWalletSavingsInterest({
    goals: [rawGoal],
    goalInterestKobo: [
      {
        goal_id: '20000000-0000-4000-8000-000000000002',
        credited_interest_kobo: 733,
      },
    ],
  });

  expect(result.goals[0]).toBe(rawGoal);
  expect(result.savingsBalance).toBe(100);
});

it('adds naira balances at two decimal places', () => {
  expect(addWalletCurrencyAmounts(125, 107.33)).toBe(232.33);
});

it('keeps goal progress at two decimals when paid interest has fractional naira', () => {
  const result = projectWalletSavingsInterest({
    goals: [{ id: goalId, current_amount: 0.1, status: 'active' }],
    goalInterestKobo: [{ goal_id: goalId, credited_interest_kobo: 20 }],
  });

  expect(result.goals[0].current_amount).toBe(0.3);
  expect(result.savingsBalance).toBe(0.3);
});
