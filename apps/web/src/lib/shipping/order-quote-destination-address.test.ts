import { describe, expect, it } from 'vitest';
import {
  matchesQuoteDestination,
  normalizeAddressForQuoteMatch,
  type OrderShippingAddressForQuote,
} from './order-quote-destination-address';
import type { parseStoredQuoteRequest } from './order-shipment-booking-utils';
import type { ShippingAddress } from './types';

type StoredQuoteRequest = NonNullable<
  ReturnType<typeof parseStoredQuoteRequest>
>;

function makeQuoteRequest(
  overrides: Omit<Partial<StoredQuoteRequest>, 'receiver'> & {
    receiver?: Partial<ShippingAddress>;
  } = {}
): StoredQuoteRequest {
  const { receiver, ...rest } = overrides;
  return {
    merchantId: 'merchant-1',
    sessionId: 'session-1',
    shipmentType: 'domestic',
    receiver: {
      name: 'Jane Receiver',
      phone: '+2348000000000',
      address: '12 Admiralty Way',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
      ...receiver,
    },
    items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
    ...rest,
  };
}

function makeOrderAddress(
  overrides: Partial<OrderShippingAddressForQuote> = {}
): OrderShippingAddressForQuote {
  return {
    address: '12 Admiralty Way',
    city: 'Lagos',
    state: 'Lagos',
    country: undefined,
    countryCode: undefined,
    postalCode: undefined,
    ...overrides,
  };
}

describe('normalizeAddressForQuoteMatch', () => {
  it('returns the trimmed street when city and state are absent', () => {
    expect(
      normalizeAddressForQuoteMatch('  12 Admiralty Way  ', null, null)
    ).toBe('12 admiralty way');
  });

  it('strips a composed city/state suffix from the street line', () => {
    expect(
      normalizeAddressForQuoteMatch(
        '12 Admiralty Way, Lagos, Lagos',
        'Lagos',
        'Lagos'
      )
    ).toBe('12 admiralty way');
  });

  it('keeps the street when the city/state suffix is not present', () => {
    expect(
      normalizeAddressForQuoteMatch('12 Admiralty Way', 'Lagos', 'Lagos')
    ).toBe('12 admiralty way');
  });
});

describe('matchesQuoteDestination', () => {
  it('matches a domestic quote against the same street/city/state', () => {
    expect(
      matchesQuoteDestination(makeOrderAddress(), makeQuoteRequest())
    ).toBe(true);
  });

  it('matches a domestic quote when checkout stores a composed street line', () => {
    expect(
      matchesQuoteDestination(
        makeOrderAddress({
          address: '12 Admiralty Way, Lagos, Lagos',
        }),
        makeQuoteRequest()
      )
    ).toBe(true);
  });

  it('rejects a domestic quote when the street only shares a prefix', () => {
    expect(
      matchesQuoteDestination(
        makeOrderAddress({
          address: '12 Admiralty Way, Block B',
        }),
        makeQuoteRequest()
      )
    ).toBe(false);
  });

  it('rejects a domestic quote when city or state differ', () => {
    expect(
      matchesQuoteDestination(
        makeOrderAddress({
          city: 'Abuja',
          state: 'FCT',
        }),
        makeQuoteRequest()
      )
    ).toBe(false);
  });

  it('matches an international quote on exact address fields', () => {
    const quoteRequest = makeQuoteRequest({
      shipmentType: 'international',
      receiver: {
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
        postalCode: 'M5V 3L9',
      },
    });

    expect(
      matchesQuoteDestination(
        makeOrderAddress({
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        }),
        quoteRequest
      )
    ).toBe(true);
  });

  it('rejects an international quote when the street differs', () => {
    const quoteRequest = makeQuoteRequest({
      shipmentType: 'international',
      receiver: {
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
        postalCode: 'M5V 3L9',
      },
    });

    expect(
      matchesQuoteDestination(
        makeOrderAddress({
          address: '999 King Street',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        }),
        quoteRequest
      )
    ).toBe(false);
  });
});
