import { toActiveSavingsGoal } from './wallet-savings-data';

describe('server keeps PiggyVest off', () => {
  it('maps a legacy goal exactly as before, with no principal_amount', () => {
    const goal = toActiveSavingsGoal({
      goal: {
        contribution_amount: '100',
        contribution_frequency: 'weekly',
        current_amount: '500',
        id: 'g',
        maturity_date: '2026-12-01',
        source_mode: 'manual',
        status: 'active',
        target_amount: '1000',
        title: 'Plan',
        variant_id: null,
      },
    });
    expect(goal?.current_amount).toBe(500);
    expect(goal).not.toHaveProperty('principal_amount');
  });
});
