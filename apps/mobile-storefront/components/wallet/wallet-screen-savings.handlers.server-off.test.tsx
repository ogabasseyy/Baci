import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { notifySavings } from './savings/savings-notice';
import { useSavingsNoticeStore } from './savings/savings-notice-store';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

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

// A legacy contribution behaves exactly as in production today: success
// clears the id and amount, and no PIN wording appears anywhere.
describe('server keeps PiggyVest off', () => {
  it('completes a legacy contribution with no PIN involvement', async () => {
    const clearIdempotencyKey = jest.fn();
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => ({ goalStatus: 'active' }),
      clearSavingsContributionAmount: jest.fn(),
      clearIdempotencyKey,
      createIdempotencyKey: () => 'op-1',
      goal,
      rawAmount: '1000',
      refetchWallet: async () => ({}),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(clearIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toMatch(
      /PIN/
    );
  });

  it('keeps the amount on screen until the result is shown (no NGN 0 flash)', async () => {
    const clearAmount = jest.fn();
    let clearedDuringRefresh: boolean | undefined;
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => ({ goalStatus: 'active' }),
      clearSavingsContributionAmount: clearAmount,
      clearIdempotencyKey: jest.fn(),
      createIdempotencyKey: () => 'op-2',
      goal,
      rawAmount: '1000',
      refetchWallet: async () => {
        clearedDuringRefresh = clearAmount.mock.calls.length > 0;
        return {};
      },
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(clearedDuringRefresh).toBe(false);
    expect(clearAmount).toHaveBeenCalledTimes(1);
  });

  it('clears the last result notice when the next contribution starts', async () => {
    notifySavings('Nice! NGN 1,000 added', undefined, 'success');
    let shownWhileSending: string | undefined;
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => {
        shownWhileSending = useSavingsNoticeStore.getState().notice?.title;
        return { goalStatus: 'active' };
      },
      clearSavingsContributionAmount: jest.fn(),
      clearIdempotencyKey: jest.fn(),
      createIdempotencyKey: () => 'op-3',
      goal,
      rawAmount: '1000',
      refetchWallet: async () => ({}),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(shownWhileSending).toBeUndefined();
  });
});
