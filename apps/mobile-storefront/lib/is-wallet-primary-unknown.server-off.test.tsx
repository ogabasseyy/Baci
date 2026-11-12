import { describe, expect, it } from '@jest/globals';
import { isWalletPrimaryUnknown } from './is-wallet-primary-unknown';

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
