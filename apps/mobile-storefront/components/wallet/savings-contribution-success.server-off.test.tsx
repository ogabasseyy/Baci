import { describe, expect, it, jest } from '@jest/globals';
import * as Haptics from 'expo-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { notifySavings } from './savings/savings-notice';
import { buildSavingsSuccessMessage } from './savings-contribution-success';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('./savings/savings-notice', () => ({ notifySavings: jest.fn() }));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly',
  current_amount: 500,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_condition: 'Used',
  product_variant_label: 'Storage: 128GB',
  source_mode: 'manual',
  status: 'active',
  target_amount: 5000,
  title: 'iPhone 13',
};

// With PiggyVest off, a legacy contribution still confirms and cheers the
// customer, and no PiggyVest or PIN wording leaks into the message.
describe('server keeps PiggyVest off', () => {
  it('cheers a confirmed legacy contribution without provider wording', async () => {
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => ({
        goalCurrentAmount: 1500,
        goalStatus: 'active',
      }),
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'op-1',
      goal,
      rawAmount: '1000',
      refetchWallet: async () => ({}),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      "Nice! ₦1,000 added. You're 30% of the way to your iPhone 13. Keep it going!",
      'success'
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(notifySavings).mock.calls)).not.toMatch(
      /PIN|PiggyVest/
    );
  });

  it('builds the cheer from the confirmed amount alone', () => {
    expect(
      buildSavingsSuccessMessage({
        amount: 4500,
        goal,
        goalCompleted: true,
        refreshFailed: false,
      }).title
    ).toBe('Goal reached! 🎉');
  });
});
