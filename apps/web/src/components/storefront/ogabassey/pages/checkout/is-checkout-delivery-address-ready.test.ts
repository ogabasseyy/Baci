import { describe, expect, it } from 'vitest';
import { isCheckoutDeliveryAddressReady } from './is-checkout-delivery-address-ready';

describe('isCheckoutDeliveryAddressReady', () => {
  it.each([
    '',
    ' ',
    'Ikeja',
    'Lagos',
    'Ikeja, Lagos',
    'Ikeja, Lagos, Nigeria',
  ])('rejects an unset street or location-only fallback: %s', (address) => {
    expect(
      isCheckoutDeliveryAddressReady({
        address,
        city: 'Ikeja',
        state: 'Lagos',
        country: 'Nigeria',
      })
    ).toBe(false);
  });
  it('requires both detected city and state', () => {
    expect(
      isCheckoutDeliveryAddressReady({
        address: '2 Olaide Tomori Street',
        city: '',
        state: 'Lagos',
      })
    ).toBe(false);
  });
  it('accepts a street with the resolved location', () => {
    expect(
      isCheckoutDeliveryAddressReady({
        address: '2 Olaide Tomori Street Ikeja, Lagos, Nigeria',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
      })
    ).toBe(true);
  });
});
