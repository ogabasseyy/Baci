import {
  getUtilityPayShortfall,
  type UtilityPayWalletSnapshot,
} from './utility-pay-readiness';

function wallet(
  overrides: Partial<UtilityPayWalletSnapshot> & { balance?: number } = {}
): UtilityPayWalletSnapshot {
  const { balance = 0, ...rest } = overrides;
  return {
    canFundByBankTransfer: false,
    getWalletBalance: () => balance,
    isAuthenticated: true,
    isWalletSettled: () => true,
    walletError: null,
    walletIsLoading: false,
    ...rest,
  };
}

const base = { retained: false, savingsCovers: false };

describe('getUtilityPayShortfall', () => {
  // The design walk found "Pay ₦100" red and enabled with ₦0 store credit.
  it('blocks ₦100 with ₦0 store credit and offers a store credit top-up', () => {
    expect(
      getUtilityPayShortfall({
        ...base,
        amount: 100,
        payment: wallet({ walletIsStoreCredit: true }),
      })
    ).toEqual({
      ctaLabel: 'Add store credit',
      message: 'Not enough store credit to pay this.',
      route: 'store-credit',
      shortfall: 100,
    });
  });

  it('allows the purchase when the balance covers it exactly', () => {
    expect(
      getUtilityPayShortfall({
        ...base,
        amount: 100,
        payment: wallet({ balance: 100, walletIsStoreCredit: true }),
      })
    ).toBeNull();
  });

  it('never blocks a kept attempt, which replays without a new charge', () => {
    expect(
      getUtilityPayShortfall({
        amount: 100,
        payment: wallet({ walletIsStoreCredit: true }),
        retained: true,
        savingsCovers: false,
      })
    ).toBeNull();
  });

  it('never blocks when the PiggyVest savings wallet pays', () => {
    expect(
      getUtilityPayShortfall({
        amount: 100,
        payment: wallet({ walletIsStoreCredit: true }),
        retained: false,
        savingsCovers: true,
      })
    ).toBeNull();
  });

  it.each([
    ['signed out', { isAuthenticated: false }],
    ['loading', { walletIsLoading: true }],
    ['failed', { walletError: new Error('down') }],
    ['unsettled', { isWalletSettled: () => false }],
    ['PiggyVest check unknown', { walletPrimaryUnknown: true }],
  ])('does not block while the wallet is %s (the submit gate answers)', (_label, state) => {
    expect(
      getUtilityPayShortfall({
        ...base,
        amount: 100,
        payment: wallet(state as Partial<UtilityPayWalletSnapshot>),
      })
    ).toBeNull();
  });

  it('does not block before there is an amount', () => {
    expect(
      getUtilityPayShortfall({ ...base, amount: 0, payment: wallet() })
    ).toBeNull();
  });
});
