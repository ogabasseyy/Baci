import { describe, expect, it } from '@jest/globals';
import { isEligibleForWalletFundedBankTransfer } from './is-eligible-for-wallet-funded-bank-transfer';

const eligible = {
  customerId: 'customer-1',
  customerPhone: '08012345678',
  isAuthenticated: true,
  residualAfterSavings: 10_000,
  walletBalance: 0,
  walletOrderAutoDebitEnabled: true,
};

describe('bank transfer to wallet eligibility', () => {
  it('stays eligible as today when the server keeps PiggyVest off', () => {
    expect(isEligibleForWalletFundedBankTransfer(eligible)).toBe(true);
    expect(
      isEligibleForWalletFundedBankTransfer({
        ...eligible,
        walletIsStoreCredit: false,
      })
    ).toBe(true);
  });

  it('is never offered to a PiggyVest customer', () => {
    expect(
      isEligibleForWalletFundedBankTransfer({
        ...eligible,
        walletIsStoreCredit: true,
      })
    ).toBe(false);
  });

  it('is not offered when the wallet already covers the order', () => {
    expect(
      isEligibleForWalletFundedBankTransfer({
        ...eligible,
        walletBalance: 10_000,
      })
    ).toBe(false);
  });
});
