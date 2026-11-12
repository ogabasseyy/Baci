import { describe, expect, it } from '@jest/globals';
import { resolveStartSavingsWalletBalance } from './start-savings-wallet-balance';

// With PiggyVest off the wallet carries no primary balance, so the plan's
// head start keeps using the legacy wallet exactly as before.
describe('start savings wallet balance with the server off', () => {
  it('uses the legacy balance and the legacy debit', () => {
    expect(
      resolveStartSavingsWalletBalance({ balance: 7500, loyalty_points: 0 })
    ).toEqual({ balance: 7500, primaryWallet: false });
  });
});
