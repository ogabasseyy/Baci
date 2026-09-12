import { describe, expect, it } from 'vitest';
import { checkoutShippingQuoteDeliveryPreference } from './checkout-shipping-quote-delivery-preference';

describe('bugfix: discover merchant pickup rates before hiding the tab', () => {
  it('prefers pickup discovery when only city and state are known', () => {
    expect(
      checkoutShippingQuoteDeliveryPreference({
        deliveryMethod: 'door',
        isStreetReady: false,
      })
    ).toBe('pickup_station');
  });

  it('uses door preference once the street is ready and door is selected', () => {
    expect(
      checkoutShippingQuoteDeliveryPreference({
        deliveryMethod: 'door',
        isStreetReady: true,
      })
    ).toBe('door');
  });
});
