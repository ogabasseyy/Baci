import { describe, expect, it } from '@jest/globals';
import { isWalletStoreCredit } from './wallet-store-credit';

// With the server keeping PiggyVest off the wallet has no primary balance,
// so purchase screens keep their wallet wording.
describe('isWalletStoreCredit with the server off', () => {
  it('is false when the wallet has no PiggyVest balance', () => {
    expect(isWalletStoreCredit({ primary_balance_kobo: undefined })).toBe(
      false
    );
    expect(isWalletStoreCredit({ primary_balance_kobo: null })).toBe(false);
    expect(isWalletStoreCredit(undefined)).toBe(false);
    expect(isWalletStoreCredit(null)).toBe(false);
  });

  it('is true for a ready PiggyVest wallet, including a zero balance', () => {
    expect(isWalletStoreCredit({ primary_balance_kobo: 0 })).toBe(true);
    expect(isWalletStoreCredit({ primary_balance_kobo: 500_000 })).toBe(true);
  });
});
