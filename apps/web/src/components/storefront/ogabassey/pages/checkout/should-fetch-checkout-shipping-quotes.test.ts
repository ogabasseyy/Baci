import { describe, expect, it } from 'vitest';
import {
  checkoutShippingQuoteDeliveryPreference,
  shouldDiscoverCheckoutPickupQuotes,
  shouldFetchCheckoutShippingQuotes,
} from './should-fetch-checkout-shipping-quotes';

describe('bugfix: load merchant pickup rates without requiring a street', () => {
  it('fetches pickup_station quotes once city and state are known', () => {
    expect(
      shouldFetchCheckoutShippingQuotes({
        deliveryMethod: 'pickup_station',
        isStreetReady: false,
        hasCityState: true,
      }),
    ).toBe(true);
  });

  it('still requires a street for door carrier quotes', () => {
    expect(
      shouldFetchCheckoutShippingQuotes({
        deliveryMethod: 'door',
        isStreetReady: false,
        hasCityState: true,
      }),
    ).toBe(false);
    expect(
      shouldFetchCheckoutShippingQuotes({
        deliveryMethod: 'door',
        isStreetReady: true,
        hasCityState: true,
      }),
    ).toBe(true);
  });
});

describe('bugfix: discover merchant pickup rates before hiding the tab', () => {
  it('discovers pickup while still on door when only city and state are known', () => {
    expect(
      shouldDiscoverCheckoutPickupQuotes({
        isStreetReady: false,
        hasCityState: true,
      }),
    ).toBe(true);
    expect(
      checkoutShippingQuoteDeliveryPreference({
        deliveryMethod: 'door',
        isStreetReady: false,
      }),
    ).toBe('pickup_station');
  });

  it('uses door preference once the street is ready and door is selected', () => {
    expect(
      shouldDiscoverCheckoutPickupQuotes({
        isStreetReady: true,
        hasCityState: true,
      }),
    ).toBe(false);
    expect(
      checkoutShippingQuoteDeliveryPreference({
        deliveryMethod: 'door',
        isStreetReady: true,
      }),
    ).toBe('door');
  });
});
