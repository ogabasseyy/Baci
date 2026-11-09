import { describe, expect, it, jest } from '@jest/globals';
import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
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

// With PiggyVest off, a legacy contribution still confirms and cheers the
// customer, and no PiggyVest or PIN wording leaks into the message.
describe('server keeps PiggyVest off', () => {
  it('cheers a confirmed legacy contribution without provider wording', async () => {
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => ({ goalStatus: 'active' }),
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'op-1',
      goal,
      rawAmount: '1000',
      refetchWallet: async () => ({}),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Savings updated',
      "Nice! ₦1,000 added. You're 30% of the way to your iPhone 13. Keep it going!"
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toMatch(
      /PIN|PiggyVest/
    );
  });
});
