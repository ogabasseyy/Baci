import { describe, expect, it } from 'vitest';
import { deriveCheckoutPaymentBaseTotal } from './derive-checkout-payment-base-total';

describe('deriveCheckoutPaymentBaseTotal', () => {
  it('uses the resumed order canonical total without adding stamped adjustments again', () => {
    expect(
      deriveCheckoutPaymentBaseTotal({
        effectiveCheckoutCartTotal: 100_000,
        deliveryCost: 12_500,
        giftWrappingCost: 1_000,
        hasCheckoutCartItems: false,
        taxAmount: 7_500,
        resumedOrderTotal: 116_000,
      })
    ).toBe(116_000);
  });

  it('keeps the fresh-cart subtotal, delivery, wrapping, and tax calculation', () => {
    expect(
      deriveCheckoutPaymentBaseTotal({
        effectiveCheckoutCartTotal: 100_000,
        deliveryCost: 12_500,
        giftWrappingCost: 1_000,
        hasCheckoutCartItems: true,
        taxAmount: 7_500,
        resumedOrderTotal: null,
      })
    ).toBe(121_000);
  });

  it('keeps active-cart pricing when a resumed order is also present', () => {
    expect(
      deriveCheckoutPaymentBaseTotal({
        effectiveCheckoutCartTotal: 100_000,
        deliveryCost: 12_500,
        giftWrappingCost: 1_000,
        hasCheckoutCartItems: true,
        taxAmount: 7_500,
        resumedOrderTotal: 99_000,
      })
    ).toBe(121_000);
  });
});
