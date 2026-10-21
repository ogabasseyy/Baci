import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  PENDING_VTU_STALE_AFTER_MS,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import {
  preserveSuppressedVtuSuccess,
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

describe('preserveSuppressedVtuSuccess', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function paymentWithRefetch(refetchWallet: jest.Mock) {
    return { refetchWallet } as unknown as PaymentState;
  }

  it('notes + completes terminal results and refreshes the wallet', async () => {
    rememberPendingVtuPurchase('d', 'k');
    const refetchWallet = jest.fn(() => Promise.resolve('ok'));

    await preserveSuppressedVtuSuccess(
      paymentWithRefetch(refetchWallet),
      'd',
      {
        reference: 'R',
        status: 'successful',
      },
      'k'
    );

    expect(hasNotedPendingVtuReference('d', 'R')).toBe(true);
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    jest
      .useFakeTimers()
      .setSystemTime(Date.now() + PENDING_VTU_STALE_AFTER_MS + 1);
    expect(isStalePendingVtuSuccess('d', 'R')).toBe(true);
  });

  it('notes processing results without completing them', async () => {
    rememberPendingVtuPurchase('d', 'k');
    const refetchWallet = jest.fn(() => Promise.resolve('ok'));

    await preserveSuppressedVtuSuccess(
      paymentWithRefetch(refetchWallet),
      'd',
      {
        reference: 'R',
        status: 'processing',
      },
      'k'
    );

    expect(hasNotedPendingVtuReference('d', 'R')).toBe(true);
    jest
      .useFakeTimers()
      .setSystemTime(Date.now() + PENDING_VTU_STALE_AFTER_MS + 1);
    expect(isStalePendingVtuSuccess('d', 'R')).toBe(false);
  });

  it('never fails when the wallet refetch rejects', async () => {
    rememberPendingVtuPurchase('d', 'k');
    const refetchWallet = jest.fn(() =>
      Promise.reject(new Error('query exploded'))
    );

    await expect(
      preserveSuppressedVtuSuccess(
        paymentWithRefetch(refetchWallet),
        'd',
        {
          reference: 'R',
          status: 'successful',
        },
        'k'
      )
    ).resolves.toBeUndefined();
    expect(hasNotedPendingVtuReference('d', 'R')).toBe(true);
  });

  it('skips the preserve when the live entry moved to a newer generation', async () => {
    // Vetoed adoption (Codex R6 P1): the loser's outcome must not
    // finalize the winner's entry — but the wallet still refreshes
    // since the suppressed onSuccess will never fire.
    rememberPendingVtuPurchase('d', 'winner-key');
    const refetchWallet = jest.fn(() => Promise.resolve('ok'));

    await preserveSuppressedVtuSuccess(
      paymentWithRefetch(refetchWallet),
      'd',
      {
        reference: 'R',
        status: 'successful',
      },
      'loser-key'
    );

    expect(hasNotedPendingVtuReference('d', 'R')).toBe(false);
    expect(refetchWallet).toHaveBeenCalledTimes(1);
  });
});
