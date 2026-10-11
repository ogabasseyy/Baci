import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { shouldDiscardVtuResultForAccountSwitch } from './vtu-account-switch';

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
