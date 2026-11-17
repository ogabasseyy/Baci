import {
  getUtilityPayShortfall,
  type UtilityPayWalletSnapshot,
} from './utility-pay-readiness';

// With the server keeping PiggyVest off the wallet is never store credit and
// the savings wallet never pays: a short wallet asks to fund the wallet, as
// production does today.
function wallet(
  balance: number,
  canFundByBankTransfer: boolean
): UtilityPayWalletSnapshot {
  return {
    canFundByBankTransfer,
    getWalletBalance: () => balance,
    isAuthenticated: true,
    isWalletSettled: () => true,
    walletError: null,
    walletIsLoading: false,
    walletIsStoreCredit: false,
    walletPrimaryUnknown: false,
  };
}

describe('getUtilityPayShortfall with the server keeping PiggyVest off', () => {
  it('sends a short wallet to bank-transfer funding when it is offered', () => {
    expect(
      getUtilityPayShortfall({
        amount: 500,
        payment: wallet(200, true),
        retained: false,
        savingsCovers: false,
      })
    ).toEqual({
      ctaLabel: 'Fund wallet',
      message: 'Not enough in your wallet to pay this.',
      route: 'bank-transfer',
      shortfall: 300,
    });
  });

  it('opens the wallet when bank transfer is not offered', () => {
    expect(
      getUtilityPayShortfall({
        amount: 500,
        payment: wallet(0, false),
        retained: false,
        savingsCovers: false,
      })
    ).toMatchObject({ ctaLabel: 'Open wallet', route: 'wallet' });
  });

  it('allows a wallet that covers the purchase', () => {
    expect(
      getUtilityPayShortfall({
        amount: 500,
        payment: wallet(500, true),
        retained: false,
        savingsCovers: false,
      })
    ).toBeNull();
  });
});
