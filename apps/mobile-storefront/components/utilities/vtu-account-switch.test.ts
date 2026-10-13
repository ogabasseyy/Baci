import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import {
  refreshWalletAfterSuppressedVtuResult,
  shouldDiscardVtuResultForAccountSwitch,
} from './vtu-account-switch';

type PaymentState = ReturnType<typeof useUtilityPayment>;

function paymentWith(
  isCurrent: boolean,
  invalidateWallets: jest.Mock = jest.fn()
): PaymentState {
  return {
    invalidateWallets,
    isSubmittingOwnerCurrent: () => isCurrent,
  } as unknown as PaymentState;
}

describe('shouldDiscardVtuResultForAccountSwitch', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the result while the submitting owner is still signed in', () => {
    const invalidateWallets = jest.fn();
    expect(
      shouldDiscardVtuResultForAccountSwitch(
        paymentWith(true, invalidateWallets),
        'user-a'
      )
    ).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(invalidateWallets).not.toHaveBeenCalled();
  });

  it('discards the result and alerts after an account switch', () => {
    const invalidateWallets = jest.fn();
    expect(
      shouldDiscardVtuResultForAccountSwitch(
        paymentWith(false, invalidateWallets),
        'user-a'
      )
    ).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account Changed',
      expect.stringContaining('changed while the purchase was processing')
    );
    // The debit may have landed: cached wallets must go stale so
    // switching back cannot serve the pre-debit balance.
    expect(invalidateWallets).toHaveBeenCalledTimes(1);
  });
});

describe('refreshWalletAfterSuppressedVtuResult', () => {
  it('awaits the wallet refetch on success', async () => {
    let settled = false;
    const refetchWallet = jest.fn(() =>
      Promise.resolve('ok').then((value) => {
        settled = true;
        return value;
      })
    );

    await refreshWalletAfterSuppressedVtuResult({ refetchWallet });

    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
  });

  it('swallows a refetch rejection instead of failing the purchase', async () => {
    const refetchWallet = jest.fn(() =>
      Promise.reject(new Error('query exploded'))
    );

    await expect(
      refreshWalletAfterSuppressedVtuResult({ refetchWallet })
    ).resolves.toBeUndefined();
    expect(refetchWallet).toHaveBeenCalledTimes(1);
  });
});
