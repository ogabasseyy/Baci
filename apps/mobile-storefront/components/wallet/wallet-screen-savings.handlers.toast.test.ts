import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { notifySavings } from './savings/savings-notice';
import { useSavingsToastStore } from './savings/savings-toast-store';
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

function add(
  result: unknown,
  closeOnConfirmed: () => void,
  refetchWallet: () => Promise<unknown> = async () => ({})
) {
  return addSavingsContributionToGoal({
    addSavingsContribution: async () => result,
    clearSavingsContributionAmount: jest.fn(),
    clearIdempotencyKey: jest.fn(),
    closeOnConfirmed,
    createIdempotencyKey: () => 'operation-1',
    goal,
    rawAmount: '100',
    refetchWallet,
    setIsAddingSavingsContribution: jest.fn(),
    walletBalance: 5000,
  });
}

describe('a confirmed contribution returns to the wallet with a toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSavingsToastStore.setState({ toast: null });
  });

  it('closes the savings sheet and toasts instead of an in-sheet "Savings updated"', async () => {
    const close = jest.fn();
    await add({ status: 'completed' }, close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(useSavingsToastStore.getState().toast?.message).toBe(
      '₦100 added to iPhone 13'
    );
    expect(notifySavings).not.toHaveBeenCalledWith(
      'Savings updated',
      expect.anything(),
      'success'
    );
  });

  it('keeps the pull-to-refresh note on the wallet when the refresh failed', async () => {
    const close = jest.fn();
    await add({ status: 'completed' }, close, async () => {
      throw new Error('offline');
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(useSavingsToastStore.getState().toast).not.toBeNull();
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      expect.stringContaining('Pull to refresh'),
      'success'
    );
  });

  it('keeps the sheet open with its in-sheet notice for a pending transfer', async () => {
    const close = jest.fn();
    await add({ status: 'pending' }, close);
    expect(close).not.toHaveBeenCalled();
    expect(useSavingsToastStore.getState().toast).toBeNull();
    expect(notifySavings).toHaveBeenCalledWith(
      'Contribution pending',
      expect.any(String),
      'info'
    );
  });

  it('keeps the sheet open with its in-sheet notice when the transfer fails', async () => {
    const close = jest.fn();
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => {
        throw new Error('Transfer failed');
      },
      clearSavingsContributionAmount: jest.fn(),
      closeOnConfirmed: close,
      createIdempotencyKey: () => 'operation-2',
      goal,
      rawAmount: '100',
      refetchWallet: async () => ({}),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(close).not.toHaveBeenCalled();
    expect(useSavingsToastStore.getState().toast).toBeNull();
    expect(notifySavings).toHaveBeenCalled();
  });
});
