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

  it('with per-goal interest reported as none, the stored balance is the exact principal', () => {
    const goals = [{ id: 'g', current_amount: 500, status: 'active' }];
    const result = projectWalletSavingsInterest({
      goals,
      goalInterestKobo: [],
      goalInterestKnown: true,
    });
    expect(result.goals[0]).toMatchObject({
      current_amount: 500,
      principal_amount: 500,
    });
    expect(result.savingsBalance).toBe(500);
  });
});
