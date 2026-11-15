import { describe, expect, it } from 'vitest';
import { getOrderGiglShippingVisibility } from './order-gigl-shipping-visibility';

describe('getOrderGiglShippingVisibility for checkout-paid GIG quotes', () => {
  const checkoutPaidOrder = {
    selected_quote_id: 'quote-1',
    shipping_funding_source: 'customer_checkout',
    shipping_provider: 'GIGL',
  } as const;

  it('keeps a saved checkout-paid GIG quote bookable for anyone who can book GIG', () => {
    expect(
      getOrderGiglShippingVisibility({
        canBookGigl: true,
        order: checkoutPaidOrder,
      }).providerBookingAvailable
    ).toBe(true);
  });

  it('bugfix: offers no GIG booking to fulfill-only or no-fulfill staff on a checkout-paid quote', () => {
    // Both reduce to canBookGigl=false (canBookOrderGigl needs fulfill + edit).
    expect(
      getOrderGiglShippingVisibility({
        canBookGigl: false,
        order: checkoutPaidOrder,
      }).providerBookingAvailable
    ).toBe(false);
  });

  it('does not gate a non-GIG saved provider quote on GIG booking rights', () => {
    expect(
      getOrderGiglShippingVisibility({
        canBookGigl: false,
        order: { ...checkoutPaidOrder, shipping_provider: 'TOPSHIP' },
      }).providerBookingAvailable
    ).toBe(true);
  });
});
