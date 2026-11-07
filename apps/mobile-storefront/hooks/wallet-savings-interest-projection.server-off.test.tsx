import { projectWalletSavingsInterest } from './wallet-savings-interest-projection';

describe('server keeps PiggyVest off', () => {
  it('with no interest credits, goals pass through untouched', () => {
    const goals = [{ id: 'g', current_amount: 500, status: 'active' }];
    const result = projectWalletSavingsInterest({
      goals,
      goalInterestKobo: [],
    });
    expect(result.goals[0]).toBe(goals[0]);
    expect(result.goals[0]).not.toHaveProperty('principal_amount');
    expect(result.appliedInterestKobo).toBe(0);
  });
});
