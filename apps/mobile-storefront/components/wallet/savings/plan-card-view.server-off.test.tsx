import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { planCardView } from './plan-card-view';

const goal = (change: Partial<WalletActiveSavingsGoal> = {}) =>
  ({
    contribution_amount: 2000,
    contribution_frequency: 'daily',
    current_amount: 0,
    id: 'goal-1',
    maturity_date: '2027-11-13',
    source_mode: 'manual',
    status: 'active',
    target_amount: 250000,
    title: 'Phone',
    ...change,
  }) as WalletActiveSavingsGoal;
const view = (g: WalletActiveSavingsGoal, awaitingSettlement = false) =>
  planCardView({ goal: g, awaitingSettlement, setupState: null });

describe('planCardView with PiggyVest off', () => {
  it('invites a first contribution on a new active plan', () => {
    expect(view(goal())).toMatchObject({
      eyebrow: 'Your next upgrade',
      actionLabel: 'Add to savings',
      footerLine: 'Start with your first contribution',
      showProgress: true,
    });
  });

  it('asks to move the savings of a funded completed plan', () => {
    expect(
      view(goal({ status: 'completed', current_amount: 250000 }), true)
    ).toMatchObject({ actionLabel: 'Complete goal', showProgress: true });
  });

  describe('bugfix: a completed plan read ₦0 of target with "Start with your first contribution"', () => {
    it('says the purchase is requested once the savings have left the plan', () => {
      expect(view(goal({ status: 'completed', current_amount: 0 }))).toEqual({
        eyebrow: 'Purchase requested',
        heading: null,
        actionLabel: 'Start another plan',
        footerLine: 'Our team will contact you to finish your order',
        showProgress: false,
        showEndDate: false,
      });
    });

    it('judges by the stored principal when interest keeps a balance showing', () => {
      expect(
        view(
          goal({
            status: 'completed',
            current_amount: 1200,
            principal_amount: 0,
          })
        ).eyebrow
      ).toBe('Purchase requested');
    });

    it('keeps the variant choice when the exact phone is still unresolved', () => {
      expect(
        view(
          goal({
            status: 'completed',
            current_amount: 0,
            selection_unresolved: true,
          })
        ).actionLabel
      ).toBe('Choose exact variant');
    });
  });
});
