import { buildCheckoutSubmitOrderRequest } from './checkout-submit-order-request';

jest.mock('./checkout-order-builders', () => ({
  buildCheckoutOrderRequest: jest.fn((input: Record<string, unknown>) => ({
    payment_method: input.paymentMethodForOrder,
  })),
}));

describe('buildCheckoutSubmitOrderRequest with PiggyVest off', () => {
  it('omits savings fields when appliedDiscountCode is set and keeps wallet credit fields', () => {
    const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest({
      address: {
        address: '12 Broad St',
        city: 'Lagos',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '08012345678',
        state: 'Lagos',
      },
      appliedDiscountCode: 'SAVE10',
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '08012345678',
      deliveryMethod: 'door',
      itemsSnapshot: [],
      liveSavingsSelection: {
        use: true,
        goalId: 'goal-1',
        amount: 15_000,
      },
      liveWalletSelection: { use: true, amount: 5_000 },
      paymentMethodForOrder: 'klump',
      selectedQuote: undefined,
      shippingProvider: undefined,
      snapshot: {
        assuranceFee: 0,
        deliveryFee: 0,
        subtotal: 50_000,
        taxAmount: 0,
        total: 50_000,
      },
    });

    expect(creditFields).toEqual({
      use_wallet_credit: true,
      wallet_amount: 5_000,
    });
    expect(orderRequest).toMatchObject({
      payment_method: 'klump',
      use_wallet_credit: true,
      wallet_amount: 5_000,
    });
  });
});
