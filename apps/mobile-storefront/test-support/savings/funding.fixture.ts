export type SavingsFundingGoalFixture = {
  current_amount: number;
  id: string;
  source_mode: 'manual';
  status: 'active';
  target_amount: number;
  title: string;
};

export const defaultSavingsFundingGoal = (): SavingsFundingGoalFixture => ({
  current_amount: 0,
  id: '430314fd-cd8b-4579-98d4-e9f345713dd6',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'iPhone savings',
});

export const createSavingsFundingWalletResponse = (
  activeSavingsGoal: SavingsFundingGoalFixture | null,
  savingsGoals: SavingsFundingGoalFixture[]
) => ({
  wallet: {
    active_savings_goal: activeSavingsGoal,
    savings_goals: savingsGoals,
    earnings_available: true,
  },
});
