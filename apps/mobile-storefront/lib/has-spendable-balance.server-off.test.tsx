import { describe, expect, it } from '@jest/globals';
import {
  hasSpendableBalance,
  SAVINGS_WALLET_CAN_PAY,
} from './has-spendable-balance';

// With the server keeping PiggyVest off no balances are passed, so nothing
// counts as spendable; callers only use this for PiggyVest-ready customers.
describe('hasSpendableBalance', () => {
  it('is false with no balances (server off)', () => {
    expect(
      hasSpendableBalance({
        savingsWalletBalance: undefined,
        storeCreditBalance: undefined,
      })
    ).toBe(false);
  });

  it('ignores PiggyVest money until the savings wallet can pay', () => {
    expect(SAVINGS_WALLET_CAN_PAY).toBe(false);
    expect(
      hasSpendableBalance({ savingsWalletBalance: 5000, storeCreditBalance: 0 })
    ).toBe(false);
  });

  it('counts store credit above zero', () => {
    expect(
      hasSpendableBalance({ savingsWalletBalance: 0, storeCreditBalance: 1 })
    ).toBe(true);
  });
});
