import {
  computeCheckoutDisplayAndKlumpGateTotals,
  resolveCheckoutStoreCreditSelections,
} from './checkout-store-credit';

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

  it('excludes savings from displayTotal and netPayableForKlumpGate when a discount code is applied', () => {
    const result = computeCheckoutDisplayAndKlumpGateTotals({
      appliedDiscountCode: 'SAVE10',
      assuranceFee: 0,
      checkoutSavingsBalance: 15_000,
      deliveryFee: 0,
      getLiveSavingsSelection: () => ({
        use: true,
        goalId: 'goal-1',
        amount: 15_000,
      }),
      items: [],
      paymentTab: 'installments',
      savingsSelectionUse: true,
      selectedPayment: 'klump',
      step: 'review',
      subtotal: 50_000,
      total: 50_000,
      walletBalance: 10_000,
      walletSelection: { use: true, amount: 10_000 },
    });

    expect(result).toEqual({
      liveSavingsSelectionForKlumpGate: undefined,
      liveWalletSelectionForKlumpGate: { use: true, amount: 10_000 },
      netPayableForKlumpGate: 40_000,
      stepDisplayTotal: 40_000,
    });
  });
});
