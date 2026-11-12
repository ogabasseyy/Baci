import { describe, expect, it } from '@jest/globals';
import {
  isWalletPrimaryUnknown,
  isWalletStoreCredit,
} from './wallet-store-credit';

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

  it('ignores a malformed PiggyVest balance', () => {
    expect(isWalletStoreCredit({ primary_balance_kobo: Number.NaN })).toBe(
      false
    );
    expect(isWalletStoreCredit({ primary_balance_kobo: -1 })).toBe(false);
  });

  it('is true for a ready PiggyVest wallet, including a zero balance', () => {
    expect(isWalletStoreCredit({ primary_balance_kobo: 0 })).toBe(true);
    expect(isWalletStoreCredit({ primary_balance_kobo: 500_000 })).toBe(true);
  });
});

describe('isWalletPrimaryUnknown', () => {
  it('is false when the server keeps PiggyVest off (a clear answer)', () => {
    expect(isWalletPrimaryUnknown({})).toBe(false);
    expect(isWalletPrimaryUnknown(undefined)).toBe(false);
  });

  it('is true while the PiggyVest check failed or timed out', () => {
    expect(isWalletPrimaryUnknown({ primary_unavailable: true })).toBe(true);
  });

  it('is false once a PiggyVest balance is known', () => {
    expect(
      isWalletPrimaryUnknown({
        primary_balance_kobo: 0,
        primary_unavailable: true,
      })
    ).toBe(false);
  });
});
