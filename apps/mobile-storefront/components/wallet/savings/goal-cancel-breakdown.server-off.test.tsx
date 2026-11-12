import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { goalCancelBreakdown } from './goal-cancel-breakdown';

const baseGoal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2027-03-16',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'iPhone 15 Pro',
} satisfies WalletActiveSavingsGoal;

// Owner rule (2026-11-12): an early cancel returns the savings only; the
// goal's interest is not refunded.
describe('goalCancelBreakdown', () => {
  it('refunds the saved amount and forfeits interest paid into the goal', () => {
    expect(
      goalCancelBreakdown({
        ...baseGoal,
        current_amount: 121240,
        principal_amount: 120000,
      })
    ).toEqual({ known: true, saved: 120000, forfeited: 1240, refund: 120000 });
  });

  it('marks the split unknown when the stored balance is missing', () => {
    expect(goalCancelBreakdown({ ...baseGoal, current_amount: 50000 })).toEqual(
      { known: false, saved: 50000, forfeited: 0, refund: 50000 }
    );
  });

  it('never refunds more than the goal holds', () => {
    expect(
      goalCancelBreakdown({
        ...baseGoal,
        current_amount: 40000,
        principal_amount: 45000,
      })
    ).toEqual({ known: true, saved: 40000, forfeited: 0, refund: 40000 });
  });
});
