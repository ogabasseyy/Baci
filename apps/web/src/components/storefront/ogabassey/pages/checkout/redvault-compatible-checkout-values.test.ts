import { describe, expect, it } from 'vitest';
import { getRedvaultCompatibleCheckoutValues } from './redvault-compatible-checkout-values';

const input = {
  baseTotal: 20000,
  discountAmount: 1500,
  discountCode: 'SAVE15',
  paymentMethod: 'paystack' as const,
  payWithWallet: true,
  walletBalance: 5000,
  walletCurrencySupported: true,
};

describe('getRedvaultCompatibleCheckoutValues', () => {
  it('preserves ordinary discount and wallet checkout values', () => {
    expect(getRedvaultCompatibleCheckoutValues(input)).toEqual({
      discountAmount: 1500,
      discountCode: 'SAVE15',
      payWithWallet: true,
      total: 18500,
      useWalletCredit: true,
      walletAmountUsed: 5000,
    });
  });

  it('removes ordinary discounts and wallet credits for REDVAULT', () => {
    expect(
      getRedvaultCompatibleCheckoutValues({
        ...input,
        paymentMethod: 'uba_redvault',
      })
    ).toEqual({
      discountAmount: 0,
      discountCode: null,
      payWithWallet: false,
      total: 20000,
      useWalletCredit: false,
      walletAmountUsed: 0,
    });
  });
});
