import { describe, expect, it } from '@jest/globals';
import { deriveStartSavingsWalletBalance } from './start-savings-wallet-balance';

// With the server keeping PiggyVest off the flow spends the legacy balance.
describe('start-savings wallet balance with the server off', () => {
  it('uses the legacy balance when no primary balance is reported', () => {
    expect(deriveStartSavingsWalletBalance({ balance: 1500 })).toBe(1500);
    expect(
      deriveStartSavingsWalletBalance({
        balance: 1500,
        primary_balance_kobo: null,
      })
    ).toBe(1500);
  });

  it('is zero without wallet data', () => {
    expect(deriveStartSavingsWalletBalance(undefined)).toBe(0);
  });

  it('uses the primary balance in naira only when it is ready', () => {
    expect(
      deriveStartSavingsWalletBalance({
        balance: 0,
        primary_balance_kobo: 250000,
      })
    ).toBe(2500);
    expect(
      deriveStartSavingsWalletBalance({ balance: 800, primary_balance_kobo: 0 })
    ).toBe(0);
  });
});
