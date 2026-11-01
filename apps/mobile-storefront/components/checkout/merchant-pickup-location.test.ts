import { describe, expect, it } from '@jest/globals';
import { getMerchantPickupLocation } from './merchant-pickup-location';

describe('getMerchantPickupLocation', () => {
  it('builds the office pickup location from fetched merchant data', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Olaide Tomori St, Ikeja, Lagos',
        business_name: 'OgaBassey',
        registered_address: {
          city: 'Ikeja',
          state: 'Lagos',
          street: '2 Olaide Tomori St',
        },
      })
    ).toEqual({
      address: '2 Olaide Tomori St, Ikeja, Lagos',
      city: 'Ikeja',
      label: 'OgaBassey Office',
      state: 'Lagos',
    });
  });

  it('returns undefined when the merchant has no office address', () => {
    expect(
      getMerchantPickupLocation({
        business_address: ' ',
        business_name: 'OgaBassey',
      })
    ).toBeUndefined();
  });

  it('derives legacy office geography from a comma-separated address', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Olaide Tomori St, Ikeja, Lagos',
        business_name: 'OgaBassey',
        registered_address: null,
      })
    ).toEqual({
      address: '2 Olaide Tomori St, Ikeja, Lagos',
      city: 'Ikeja',
      label: 'OgaBassey Office',
      state: 'Lagos',
    });
  });

  it('does not use a postal code as the missing state', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Olaide Tomori Street, Ikeja, 100001',
        registered_address: {
          street: '2 Olaide Tomori Street',
          city: 'Ikeja',
          state: null,
          postal_code: '100001',
        },
      })
    ).toBeUndefined();
  });

  it.each([
    '100001',
    'LA123ABC',
  ])('recognizes a state before postcode %s and country', (postcode) => {
    expect(
      getMerchantPickupLocation({
        business_address: `2 Olaide Tomori Street, Ikeja, Lagos, ${postcode}, Nigeria`,
        registered_address: null,
      })
    ).toMatchObject({ city: 'Ikeja', state: 'Lagos' });
  });

  it('handles eight-digit postcodes before and after a state', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, Ikeja, 10000123, Lagos',
      })
    ).toMatchObject({ city: 'Ikeja', state: 'Lagos' });
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, Ikeja, Lagos, 10000123',
      })
    ).toMatchObject({ city: 'Ikeja', state: 'Lagos' });
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, 10000123, Lagos',
      })
    ).toBeUndefined();
  });

  it('recognizes Abuja as the FCT state in a legacy address', () => {
    expect(
      getMerchantPickupLocation({ business_address: 'Plot 1, Wuse, Abuja' })
    ).toMatchObject({ city: 'Wuse', state: 'FCT' });
  });

  it('recognizes the existing FCT - Abuja shipping label', () => {
    expect(
      getMerchantPickupLocation({
        business_address: 'Plot 1, Wuse, FCT - Abuja',
      })
    ).toMatchObject({ city: 'Wuse', state: 'FCT' });
  });

  it('matches a structured Abuja state to inferred FCT while preserving the supplied value', () => {
    expect(
      getMerchantPickupLocation({
        business_address: 'Plot 1, Wuse, Abuja',
        registered_address: { city: null, state: 'Abuja' },
      })
    ).toMatchObject({ city: 'Wuse', state: 'Abuja' });
  });

  it('retains city names containing a phase number', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '12 Admiralty Way, Lekki Phase 1, Lagos',
      })
    ).toMatchObject({ city: 'Lekki Phase 1', state: 'Lagos' });
  });

  it('uses a structured city when a spaced postcode precedes the legacy state', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, LA 123 ABC, Lagos',
        registered_address: { city: 'Ikeja', state: null },
      })
    ).toMatchObject({ city: 'Ikeja', state: 'Lagos' });
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, LA 123 ABC, Lagos',
      })
    ).toBeUndefined();
  });

  it.each([
    'FC 02 A09 DB 09',
    'FC02A09DB09',
  ])('does not mistake the new postcode %s for a city', (postcode) => {
    expect(
      getMerchantPickupLocation({
        business_address: `Plot 15, ${postcode}, Abuja`,
      })
    ).toBeUndefined();
  });

  it('recognizes a city before a postcode and state', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, Ikeja, 100001, Lagos',
      })
    ).toMatchObject({ city: 'Ikeja', state: 'Lagos' });
  });

  it('does not use a postal code as the city before a state', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, 100001, Lagos',
      })
    ).toBeUndefined();
  });

  it('does not infer a state from a legacy address with an unrelated trailing location', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, Ikeja, Lagos, Ontario 123',
      })
    ).toBeUndefined();
    expect(
      getMerchantPickupLocation({
        business_address: '2 Main Street, Ikeja, Lagos, Ontario',
      })
    ).toBeUndefined();
  });

  it('does not combine an inferred city with a conflicting structured state', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Olaide Tomori Street, Ikeja, Lagos',
        registered_address: { city: null, state: 'Ontario', country: 'Canada' },
      })
    ).toBeUndefined();
  });

  it('does not guess an unverified foreign legacy region', () => {
    expect(
      getMerchantPickupLocation({
        business_address: '123 King St, Toronto, Ontario',
      })
    ).toBeUndefined();
  });

  it('keeps explicit non-Nigerian structured geography authoritative', () => {
    expect(
      getMerchantPickupLocation({
        business_address: 'unstructured',
        registered_address: {
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
        },
      })
    ).toMatchObject({ city: 'Toronto', state: 'Ontario' });
  });

  it('uses the registered address when the legacy address is absent', () => {
    expect(
      getMerchantPickupLocation({
        business_name: 'OgaBassey',
        registered_address: {
          city: 'Ikeja',
          state: 'Lagos',
          street: '2 Olaide Tomori St',
        },
      })
    ).toEqual({
      address: '2 Olaide Tomori St',
      city: 'Ikeja',
      label: 'OgaBassey Office',
      state: 'Lagos',
    });
  });

  it('does not guess legacy geography from an unstructured address', () => {
    expect(
      getMerchantPickupLocation({
        business_address: 'Taiyelolu Towers First Floor',
        business_name: 'OgaBassey',
        registered_address: null,
      })
    ).toBeUndefined();
  });

  it.each([
    { city: ' ', state: 'Lagos' },
    { city: 'Ikeja', state: ' ' },
  ])('falls back when structured office geography is incomplete', (registeredAddress) => {
    expect(
      getMerchantPickupLocation({
        business_address: '2 Olaide Tomori St, Ikeja, Lagos',
        business_name: 'OgaBassey',
        registered_address: registeredAddress,
      })
    ).toMatchObject({
      city: 'Ikeja',
      state: 'Lagos',
    });
  });
});
