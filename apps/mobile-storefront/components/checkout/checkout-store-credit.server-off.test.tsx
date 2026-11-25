import { resolveCheckoutStoreCreditSelections } from './checkout-store-credit';

describe('resolveCheckoutStoreCreditSelections with PiggyVest off', () => {
  it('excludes savings selection when a discount code is applied while preserving wallet balance', () => {
    const result = resolveCheckoutStoreCreditSelections({
      appliedDiscountCode: 'SAVE10',
      getLiveSavingsSelection: () => ({
        use: true,
        goalId: 'goal-1',
        amount: 15_000,
      }),
      itemsSnapshot: [],
      paymentTab: 'installments',
      selectedPayment: 'klump',
      snapshotTotal: 50_000,
      walletBalance: 20_000,
      walletSelection: { use: true, amount: 20_000 },
    });

    expect(result).toEqual({
      liveSavingsSelection: undefined,
      liveWalletSelection: { use: true, amount: 20_000 },
    });
  });
});
