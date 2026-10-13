import { describe, expect, it } from '@jest/globals';
import { createCheckoutSnapshot } from './checkout-order-builders';
import { buildCheckoutSubmitOrderRequest } from './checkout-submit-order-request';

const address = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '08012345678',
  address: '1 Test Street',
  city: 'Lagos',
  state: 'Lagos',
};

const itemsSnapshot = [
  {
    id: 'line-1',
    product_id: 'product-1',
    slug: 'macbook-air-m1',
    name: 'MacBook Air M1',
    price: 690000,
    quantity: 1,
  },
];

function baseInput() {
  return {
    address,
    appliedDiscountCode: undefined as string | undefined,
    customerEmail: 'ada@example.com',
    customerName: 'Ada Lovelace',
    customerPhone: '08012345678',
    deliveryMethod: 'door' as const,
    itemsSnapshot,
    liveSavingsSelection: undefined,
    liveWalletSelection: undefined,
    paymentMethodForOrder: 'credit_direct',
    selectedQuote: undefined,
    shippingProvider: undefined,
    snapshot: createCheckoutSnapshot(itemsSnapshot, 0, 0),
  };
}

describe('buildCheckoutSubmitOrderRequest', () => {
  it('merges store-credit fields into the order request', () => {
    const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest({
      ...baseInput(),
      liveSavingsSelection: {
        amount: 470000,
        goalId: '123e4567-e89b-12d3-a456-426614174555',
        use: true,
      },
      liveWalletSelection: { amount: 1000, use: true },
    });

    expect(creditFields).toEqual({
      savings_amount: 470000,
      savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
      use_savings_credit: true,
      use_wallet_credit: true,
      wallet_amount: 1000,
    });
    expect(orderRequest).toEqual(
      expect.objectContaining({
        customer_email: 'ada@example.com',
        savings_amount: 470000,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        use_savings_credit: true,
        use_wallet_credit: true,
        wallet_amount: 1000,
      })
    );
  });

  it('omits savings fields when a discount code is applied', () => {
    const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest({
      ...baseInput(),
      appliedDiscountCode: 'SAVE10',
      liveSavingsSelection: {
        amount: 470000,
        goalId: '123e4567-e89b-12d3-a456-426614174555',
        use: true,
      },
      liveWalletSelection: { amount: 1000, use: true },
    });

    expect(creditFields).toEqual({
      use_wallet_credit: true,
      wallet_amount: 1000,
    });
    expect(orderRequest).toEqual(
      expect.objectContaining({
        use_wallet_credit: true,
        wallet_amount: 1000,
      })
    );
    expect(orderRequest).not.toEqual(
      expect.objectContaining({ use_savings_credit: expect.anything() })
    );
  });
});
