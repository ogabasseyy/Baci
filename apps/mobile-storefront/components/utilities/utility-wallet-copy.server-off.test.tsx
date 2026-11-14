import { describe, expect, it } from '@jest/globals';
import { getUtilityWalletCopy } from './utility-wallet-copy';

describe('getUtilityWalletCopy', () => {
  it('keeps "Wallet" copy when the server keeps PiggyVest off', () => {
    const copy = getUtilityWalletCopy(false);
    expect(copy.pay).toBe('Pay with wallet');
    expect(copy.title).toBe('Wallet');
    expect(copy.unavailable).toBe('Wallet unavailable');
  });

  it('names store credit in every state for a PiggyVest customer', () => {
    const copy = getUtilityWalletCopy(true);
    for (const text of Object.values(copy)) {
      expect(text).not.toMatch(/wallet/i);
    }
    expect(copy.pay).toBe('Pay with store credit');
    expect(copy.unavailable).toBe('Store credit unavailable');
  });
});
