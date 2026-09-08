import { describe, expect, it } from 'vitest';
import { shouldFetchCheckoutShippingQuotes } from './should-fetch-checkout-shipping-quotes';

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
