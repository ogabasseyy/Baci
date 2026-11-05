import { type WalletActiveSavingsGoal, walletKeys } from './wallet-query';

describe('server keeps PiggyVest off', () => {
  it('a goal without principal_amount (no PiggyVest data) is a valid goal shape', () => {
    const goal: WalletActiveSavingsGoal = {
      contribution_amount: 1,
      contribution_frequency: 'weekly',
      current_amount: 10,
      id: 'g',
      maturity_date: '2026-12-01',
      source_mode: 'manual',
      status: 'active',
      target_amount: 100,
      title: 'Plan',
    };
    expect(goal.principal_amount).toBeUndefined();
    expect(walletKeys.all).toBeDefined();
  });
});
