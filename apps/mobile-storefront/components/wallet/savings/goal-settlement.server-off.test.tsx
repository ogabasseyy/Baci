import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isFundedUnsettledGoal } from './goal-settlement';

// The helper only classifies a goal; whether PiggyVest is on is the gate's
// call, so with the server off a completed goal is classified but the gate
// (not this file) keeps the screens unchanged.
describe('server keeps PiggyVest off', () => {
  it('classifies goals without reaching any server', () => {
    expect(
      isFundedUnsettledGoal({
        status: 'completed',
        current_amount: 1,
      } as WalletActiveSavingsGoal)
    ).toBe(true);
    expect(isFundedUnsettledGoal(null)).toBe(false);
  });
});
