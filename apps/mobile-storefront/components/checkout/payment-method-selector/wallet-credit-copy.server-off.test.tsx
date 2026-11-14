import { describe, expect, it } from '@jest/globals';
import { getWalletCreditCopy } from './wallet-credit-copy';

describe('checkout wallet copy', () => {
  it('keeps the wallet wording when the server keeps PiggyVest off', () => {
    const copy = getWalletCreditCopy(false);
    expect(copy.coversFullyLabel).toBe('Pay with wallet');
    expect(copy.partialLabel).toBe('Use wallet credit');
    expect(
      copy.accessibilityLabel({
        balance: 5000,
        coversFully: true,
        portion: 5000,
        total: 5000,
      })
    ).toBe('Pay with wallet, ₦5,000 available');
  });

  it('labels the balance store credit for PiggyVest customers', () => {
    const copy = getWalletCreditCopy(true);
    expect(copy.coversFullyLabel).toBe('Pay with store credit');
    expect(copy.partialLabel).toBe('Use store credit');
    expect(copy.sourceName).toBe('store credit');
    expect(
      copy.accessibilityLabel({
        balance: 2000,
        coversFully: false,
        portion: 2000,
        total: 5000,
      })
    ).toBe('Use store credit, ₦2,000 of ₦5,000');
  });
});
