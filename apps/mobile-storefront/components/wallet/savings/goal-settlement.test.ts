import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isFundedUnsettledGoal } from './goal-settlement';

const goal = (over: Partial<WalletActiveSavingsGoal>) =>
  ({
    id: 'g',
    status: 'completed',
    current_amount: 5000,
    target_amount: 5000,
    ...over,
  }) as WalletActiveSavingsGoal;

describe('isFundedUnsettledGoal', () => {
  it('is true for a completed goal that still holds money', () => {
    expect(isFundedUnsettledGoal(goal({}))).toBe(true);
  });
  it('is false once the balance has moved out', () => {
    expect(isFundedUnsettledGoal(goal({ current_amount: 0 }))).toBe(false);
  });
  it.each(['active', 'paused'] as const)('is false for a %s goal', (status) => {
    expect(isFundedUnsettledGoal(goal({ status }))).toBe(false);
  });
  it('is false without a goal', () => {
    expect(isFundedUnsettledGoal(null)).toBe(false);
  });
});
