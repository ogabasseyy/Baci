import { describe, expect, it } from 'vitest';
import { normalizeNigerianQuoteReceiver } from './normalize-nigerian-quote-receiver';

const receiver = {
  name: 'Customer',
  phone: '+2348012345678',
  address: '2 Olaide Tomori Street, Ikeja, Lagos 100001, Nigeria',
  city: 'Ikeja',
  state: '100001',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('normalizeNigerianQuoteReceiver', () => {
  it('repairs a postal code supplied as state using the formatted address', () => {
    const result = normalizeNigerianQuoteReceiver(
      {
        ...receiver,
        address: '2 Olaide Tomori Street, Ikeja, Lagos 100001, Nigeria',
      },
      'domestic'
    );

    expect(result.state).toBe('Lagos');
  });

  it('prefers a trailing state over a state name in a street segment', () => {
    const result = normalizeNigerianQuoteReceiver(
      {
        ...receiver,
        address: '12 Oyo Road, Ikeja, Lagos, Nigeria',
      },
      'domestic'
    );

    expect(result.state).toBe('Lagos');
  });

  it('repairs a malformed state from a canonical state in the address', () => {
    expect(
      normalizeNigerianQuoteReceiver(
        {
          ...receiver,
          address: '12 Ahmadu Bello Way, Katsina, Katsina State, Nigeria',
          city: 'Katsina',
          state: '820101',
        },
        'domestic'
      ).state
    ).toBe('Katsina');
  });

  it('canonicalizes recognized Nigerian state aliases', () => {
    expect(
      normalizeNigerianQuoteReceiver(
        { ...receiver, city: 'Gwarinpa', state: 'Federal Capital Territory' },
        'domestic'
      ).state
    ).toBe('FCT - Abuja');
  });

  it('does not rewrite international destinations', () => {
    const international = {
      ...receiver,
      city: 'Toronto',
      state: 'M5V 3L9',
      country: 'Canada',
      countryCode: 'CA',
    };

    expect(
      normalizeNigerianQuoteReceiver(international, 'international')
    ).toEqual(international);
  });

  it('fills blank domestic country fields with Nigeria/NG before persist', () => {
    expect(
      normalizeNigerianQuoteReceiver(
        {
          ...receiver,
          country: '',
          countryCode: '',
          state: 'Lagos',
        },
        'domestic'
      )
    ).toMatchObject({
      country: 'Nigeria',
      countryCode: 'NG',
      state: 'Lagos',
    });
  });

  it('preserves an unknown domestic location instead of guessing', () => {
    const unknown = {
      ...receiver,
      address: '12 Unknown Road, New Town, Nigeria',
      city: 'New Town',
      state: 'Unknown',
    };

    expect(normalizeNigerianQuoteReceiver(unknown, 'domestic')).toEqual(
      unknown
    );
  });

  it('does not infer a state from a city-only fallback label', () => {
    const ambiguous = {
      ...receiver,
      address: '12 Market Road, Karu, Nigeria',
      city: 'Karu',
      state: '900001',
    };
    const result = normalizeNigerianQuoteReceiver(ambiguous, 'domestic');

    expect(result).toEqual(ambiguous);
  });

  it('does not throw when the street address is missing', () => {
    const withoutStreet = {
      ...receiver,
      address: undefined as unknown as string,
      city: 'Ikeja',
      state: '100001',
    };

    expect(normalizeNigerianQuoteReceiver(withoutStreet, 'domestic')).toEqual(
      withoutStreet
    );
  });
});
