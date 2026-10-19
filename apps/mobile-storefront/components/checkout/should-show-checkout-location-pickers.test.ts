import { describe, expect, it } from '@jest/globals';
import { shouldShowCheckoutLocationPickers } from './should-show-checkout-location-pickers';

describe('shouldShowCheckoutLocationPickers', () => {
  it('hides manual location fields until an address has been entered', () => {
    expect(
      shouldShowCheckoutLocationPickers({
        address: '',
        city: '',
        hasCoordinates: false,
        state: '',
      })
    ).toBe(false);
  });

  it('shows manual location fields for pickup before a street address exists', () => {
    expect(
      shouldShowCheckoutLocationPickers({
        address: '',
        city: '',
        hasCoordinates: false,
        isPickupStation: true,
        state: '',
      })
    ).toBe(true);
  });

  it('hides manual location fields for a complete Google location', () => {
    expect(
      shouldShowCheckoutLocationPickers({
        address: '2 Olaide Tomori Street',
        city: 'Ikeja',
        hasCoordinates: true,
        state: 'Lagos',
      })
    ).toBe(false);
  });

  it.each([
    { city: 'Ikeja', hasCoordinates: false, state: 'Lagos' },
    { city: '', hasCoordinates: true, state: 'Lagos' },
    { city: 'Ikeja', hasCoordinates: true, state: '' },
  ])('shows manual fields when Google location data is incomplete', (location) => {
    expect(
      shouldShowCheckoutLocationPickers({
        address: '2 Olaide Tomori Street',
        ...location,
      })
    ).toBe(true);
  });
});
