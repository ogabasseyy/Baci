import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { shouldDiscardVtuResultForAccountSwitch } from './vtu-account-switch';

type PaymentState = ReturnType<typeof useUtilityPayment>;

function paymentWith(isCurrent: boolean): PaymentState {
  return {
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
    expect(
      shouldDiscardVtuResultForAccountSwitch(paymentWith(true), 'user-a')
    ).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('discards the result and alerts after an account switch', () => {
    expect(
      shouldDiscardVtuResultForAccountSwitch(paymentWith(false), 'user-a')
    ).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account Changed',
      expect.stringContaining('changed while the purchase was processing')
    );
  });
});
