import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { PIN_CANCELLED_CODE } from '@/lib/wallet-pin-proof';
import { notifySavings } from './savings/savings-notice';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('./savings/savings-notice', () => {
  const notifySavings = jest.fn();
  return {
    clearSavingsNotice: jest.fn(),
    notifySavings,
    savingsNotifier: () => notifySavings,
  };
});

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
    expect(notifySavings).toHaveBeenCalledWith(
      'Unable to add savings',
      'Your wallet is unavailable.',
      'warning'
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
    expect(notifySavings).not.toHaveBeenCalled();
    expect(setIsAddingSavingsContribution).toHaveBeenLastCalledWith(false);
  });

  it('tells the customer to add money, and keeps the stored id, when PiggyVest reports insufficient funds', async () => {
    const { clearIdempotencyKey } = await fail(
      Object.assign(new Error('Insufficient funds'), {
        code: 'INSUFFICIENT_FUNDS',
      })
    );
    expect(notifySavings).toHaveBeenCalledTimes(1);
    expect(notifySavings).toHaveBeenCalledWith(
      'Not enough money in your wallet',
      'Add money to your wallet, then try again.',
      'warning'
    );
    // Nothing moved, so the same operation id stays valid for the retry.
    expect(clearIdempotencyKey).not.toHaveBeenCalled();
  });
});
