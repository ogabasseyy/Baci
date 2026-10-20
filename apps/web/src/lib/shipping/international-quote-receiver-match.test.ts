import { describe, expect, it } from 'vitest';
import {
  matchesDomesticReceiverAddress,
  matchesReceiverCountryFields,
} from './international-quote-receiver-match';
import type { QuoteRequest } from './types';

const domesticReceiver: QuoteRequest['receiver'] = {
  name: 'Jane',
  phone: '08012345678',
  address: '12 Admiralty Way',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('matchesReceiverCountryFields', () => {
  it('defaults blank domestic country fields to Nigeria/NG on both sides', () => {
    expect(
      matchesReceiverCountryFields(
        { country: '', countryCode: '  ' },
        { ...domesticReceiver, country: '', countryCode: '' },
        'domestic'
      )
    ).toBe(true);
  });

  it('does not default blank international country fields', () => {
    expect(
      matchesReceiverCountryFields(
        { country: '', countryCode: '' },
        { ...domesticReceiver, country: 'Canada', countryCode: 'CA' },
        'international'
      )
    ).toBe(false);
  });
});

describe('matchesDomesticReceiverAddress', () => {
  it('preserves the existing prefix fallback after a composed quote city/state suffix', () => {
    expect(
      matchesDomesticReceiverAddress(
        {
          ...domesticReceiver,
          address: '12 Admiralty Way, Lagos, Lagos, additional delivery note',
        },
        { ...domesticReceiver, address: '12 Admiralty Way, Lagos, Lagos' }
      )
    ).toBe(true);
  });

  it('accepts matching composed domestic streets on the order and quote', () => {
    const composedReceiver = {
      ...domesticReceiver,
      address: '12 Admiralty Way, Lagos, Lagos',
    };
    expect(
      matchesDomesticReceiverAddress(composedReceiver, composedReceiver)
    ).toBe(true);
  });

  it('does not broaden composed quote matching to a different building suffix', () => {
    expect(
      matchesDomesticReceiverAddress(
        {
          ...domesticReceiver,
          address: '12 Admiralty Way, Block B, Lagos, Lagos',
        },
        { ...domesticReceiver, address: '12 Admiralty Way, Lagos, Lagos' }
      )
    ).toBe(false);
  });

  it('accepts place-order composed street, city, state format', () => {
    expect(
      matchesDomesticReceiverAddress(
        {
          address: '12 Admiralty Way, Lagos, Lagos',
          city: 'Lagos',
          state: 'Lagos',
        },
        domesticReceiver
      )
    ).toBe(true);
  });
});
