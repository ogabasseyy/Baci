import { describe, expect, it } from 'vitest';
import { deriveMerchantLocation } from './merchant-location';

describe('deriveMerchantLocation', () => {
  describe('bugfix: street, city, state, postal_code business addresses', () => {
    it('preserves the city when the segment before a trailing postal code is a state', () => {
      const location = deriveMerchantLocation(
        '2 Olaide Tomori Street, Ikeja, Lagos, 100001'
      );

      expect(location).toEqual({
        address: '2 Olaide Tomori Street, Ikeja, Lagos, 100001',
        city: 'Ikeja',
        state: 'Lagos',
      });
    });
  });

  it('returns Maitama with an empty state for postal-code-only legacy addresses', () => {
    expect(
      deriveMerchantLocation('29 Yedseram Crescent, Maitama, 904101')
    ).toEqual({
      address: '29 Yedseram Crescent, Maitama, 904101',
      city: 'Maitama',
      state: '',
    });
  });

  it('falls back to the locality before an unknown-state postal code', () => {
    expect(deriveMerchantLocation('12 Example Road, Kubwa, 900001')).toEqual({
      address: '12 Example Road, Kubwa, 900001',
      city: 'Kubwa',
      state: '',
    });
  });
});
