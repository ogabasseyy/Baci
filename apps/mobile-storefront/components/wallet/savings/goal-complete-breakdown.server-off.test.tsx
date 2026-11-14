import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { goalCompleteBreakdown } from './goal-complete-breakdown';

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 251000,
  id: 'goal-1',
  maturity_date: '2027-03-16',
  source_mode: 'manual',
  status: 'completed',
  target_amount: 250000,
  title: 'iPhone 15',
} satisfies WalletActiveSavingsGoal;

// Pure arithmetic over the goal the wallet already holds: the same whether
// PiggyVest is on or off.
describe('goal complete breakdown with the server off', () => {
  it('splits saved money and interest when the saved amount is known', () => {
    expect(
      goalCompleteBreakdown({ ...goal, principal_amount: 250000 })
    ).toEqual({
      known: true,
      saved: 250000,
      interest: 1000,
      total: 251000,
    });
  });

  it('shows no split when the saved amount is unknown', () => {
    expect(goalCompleteBreakdown(goal)).toEqual({
      known: false,
      saved: 251000,
      interest: 0,
      total: 251000,
    });
  });
});
