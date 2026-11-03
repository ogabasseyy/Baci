import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { PIN_CANCELLED_CODE } from '@/lib/wallet-pin-proof';
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

async function fail(error: Error) {
  const clearIdempotencyKey = jest.fn();
  const setIsAddingSavingsContribution = jest.fn();
  await addSavingsContributionToGoal({
    addSavingsContribution: async () => {
      throw error;
    },
    clearSavingsContributionAmount: jest.fn(),
    clearIdempotencyKey,
    createIdempotencyKey: () => 'op-1',
    goal,
    rawAmount: '1000',
    refetchWallet: async () => ({}),
    setIsAddingSavingsContribution,
    walletBalance: 5000,
  });
  return { clearIdempotencyKey, setIsAddingSavingsContribution };
}

describe('failed wallet contributions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('releases the stored id when the server cancelled the reservation', async () => {
    const { clearIdempotencyKey } = await fail(
      Object.assign(new Error('Your wallet is unavailable.'), {
        code: 'WALLET_UNAVAILABLE',
      })
    );
    expect(clearIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to add savings',
      'Your wallet is unavailable.'
    );
  });

  it('keeps the stored id for any other failure', async () => {
    const { clearIdempotencyKey } = await fail(new Error('timed out'));
    expect(clearIdempotencyKey).not.toHaveBeenCalled();
  });

  it('stays silent and keeps the stored id when the PIN sheet was closed', async () => {
    const { clearIdempotencyKey, setIsAddingSavingsContribution } = await fail(
      Object.assign(new Error('PIN entry cancelled.'), {
        code: PIN_CANCELLED_CODE,
      })
    );
    expect(clearIdempotencyKey).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(setIsAddingSavingsContribution).toHaveBeenLastCalledWith(false);
  });
});
