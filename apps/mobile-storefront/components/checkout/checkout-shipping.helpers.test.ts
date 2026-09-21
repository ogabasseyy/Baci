import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CartItem } from '@/stores/cart-store';

let mockMerchantId = 'merchant-1';

jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_ID() {
      return mockMerchantId;
    },
  },
}));

jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_MERCHANT_ID: 'checkout-merchant-1',
}));

import {
  fetchShippingQuotes,
  normalizeStateName,
  resolveGoogleCitySuggestionAction,
} from './checkout-shipping.helpers';
import type { ShippingQuote } from './types';

const createCartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'cart-1',
  name: 'iPhone 11 Pro Max',
  price: 470000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-11-pro-max',
  ...overrides,
});

const createShippingQuote = (
  overrides: Partial<ShippingQuote> = {}
): ShippingQuote => ({
  displayName: 'Topship Standard',
  id: 'quote-1',
  price: 5000,
  provider: 'Topship',
  ...overrides,
});

describe('checkout-shipping.helpers', () => {
  beforeEach(() => {
    mockMerchantId = 'merchant-1';
  });

  it('normalizes Google state aliases to known shipping state labels', () => {
    expect(normalizeStateName('fct', ['FCT - Abuja', 'Lagos'])).toBe(
      'FCT - Abuja'
    );
    expect(
      normalizeStateName('Federal Capital Territory', ['Abuja', 'Lagos'])
    ).toBe('Abuja');
    expect(
      normalizeStateName('Lagos State', ['FCT - Abuja', 'Lagos', 'Ogun'])
    ).toBe('Lagos');
  });

  it('returns the trimmed input when no known state match exists', () => {
    expect(normalizeStateName(' Anambra ', ['Lagos', 'Ogun'])).toBe('Anambra');
  });

  it('resolves Google city suggestions against loaded cities', () => {
    expect(
      resolveGoogleCitySuggestionAction(['Ikeja', 'Yaba'], 'ikeja')
    ).toEqual({ type: 'selectCity', city: 'Ikeja' });
    expect(resolveGoogleCitySuggestionAction(['Ikeja'], 'Magodo')).toEqual({
      type: 'seedSearch',
      city: 'Magodo',
    });
    expect(resolveGoogleCitySuggestionAction(['Ikeja'], '')).toEqual({
      type: 'openPicker',
    });
    expect(resolveGoogleCitySuggestionAction([], 'Ikeja')).toEqual({
      type: 'none',
    });
  });

  it('sets normalized quotes and preferred selection when quote request succeeds', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        quotes: {
          all: [createShippingQuote({ id: 'quote-1', provider: 'Provider A' })],
        },
      }),
      ok: true,
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const setIsLoadingQuotes = jest.fn();
    const setSelectedQuoteId = jest.fn();
    const setResolvedShippingQuoteContextKey = jest.fn();
    const setShippingQuotes = jest.fn();

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Lagos',
      customer: null,
      latitude: 6.5244,
      longitude: 3.3792,
      items: [
        createCartItem(),
        createCartItem({
          id: 'cart-2',
          negotiatedPrice: 800,
          price: 1000,
          quantity: 2,
        }),
      ],
      quoteContextKey: 'Lagos|Lagos',
      setIsLoadingQuotes,
      setResolvedShippingQuoteContextKey,
      setSelectedQuoteId,
      setShippingQuotes,
      shouldResetSelection: true,
      state: 'Lagos',
      watchedAddress: '1 Marina',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    expect(setIsLoadingQuotes).toHaveBeenCalledWith(true);
    expect(setShippingQuotes).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'quote-1',
          provider: 'Provider A',
        }),
      ])
    );
    expect(setResolvedShippingQuoteContextKey).toHaveBeenCalledWith(
      'Lagos|Lagos'
    );
    expect(setSelectedQuoteId).toHaveBeenLastCalledWith('quote-1');
    expect(setIsLoadingQuotes).toHaveBeenLastCalledWith(false);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.merchantId).toBe('merchant-1');
    expect(requestBody.supports_merchant_rates).toBe(true);
    expect(requestBody.cart_subtotal).toBe(472000);
    expect(requestBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'iPhone 11 Pro Max',
          quantity: 2,
          value: 1000,
        }),
      ])
    );
    expect(requestBody.receiver).toMatchObject({
      latitude: 6.5244,
      longitude: 3.3792,
    });
  });

  it('omits coordinates when only one coordinate is available', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({ quotes: { all: [] } }),
      ok: true,
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Lagos',
      customer: null,
      latitude: 6.5244,
      items: [createCartItem()],
      quoteContextKey: 'Lagos|Lagos',
      setIsLoadingQuotes: jest.fn(),
      setResolvedShippingQuoteContextKey: jest.fn(),
      setSelectedQuoteId: jest.fn(),
      setShippingQuotes: jest.fn(),
      shouldResetSelection: true,
      state: 'Lagos',
      watchedAddress: '1 Marina',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.receiver).not.toHaveProperty('latitude');
    expect(requestBody.receiver).not.toHaveProperty('longitude');
  });

  it('falls back to the checkout merchant id when config merchant id is blank', async () => {
    mockMerchantId = '';
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        quotes: {
          all: [createShippingQuote({ id: 'quote-1', provider: 'Provider A' })],
        },
      }),
      ok: true,
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Lagos',
      customer: null,
      items: [createCartItem()],
      quoteContextKey: 'Lagos|Lagos',
      setIsLoadingQuotes: jest.fn(),
      setResolvedShippingQuoteContextKey: jest.fn(),
      setSelectedQuoteId: jest.fn(),
      setShippingQuotes: jest.fn(),
      shouldResetSelection: true,
      state: 'Lagos',
      watchedAddress: '1 Marina',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.merchantId).toBe('checkout-merchant-1');
  });

  it('sends a station-pickup delivery preference and selects provider station quotes', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        quotes: {
          all: [
            createShippingQuote({
              id: 'door-quote',
              provider: 'GIGL',
            }),
            createShippingQuote({
              displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
              id: 'station-quote',
              isStationPickup: true,
              price: 9493,
              provider: 'GIGL',
              stationName: 'PORT HARCOURT',
            }),
          ],
        },
      }),
      ok: true,
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const setShippingQuotes = jest.fn();
    const setSelectedQuoteId = jest.fn();

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Port Harcourt',
      customer: null,
      deliveryPreference: 'pickup_station',
      items: [createCartItem()],
      quoteContextKey: 'Rivers|Port Harcourt',
      setIsLoadingQuotes: jest.fn(),
      setResolvedShippingQuoteContextKey: jest.fn(),
      setSelectedQuoteId,
      setShippingQuotes,
      shouldResetSelection: true,
      state: 'Rivers',
      watchedAddress: '5 Customer Street',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.deliveryPreference).toBe('pickup_station');
    expect(setShippingQuotes).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'station-quote', isStationPickup: true }),
    ]);
    expect(setSelectedQuoteId).toHaveBeenLastCalledWith('station-quote');
  });

  it('keeps pickup stations matching the selected city when the provider returns wider state options', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        quotes: {
          all: [
            createShippingQuote({
              displayName: 'GIG Logistics - Pickup at IKEJA ALLEN',
              id: 'ikeja-station',
              isStationPickup: true,
              provider: 'GIGL',
              stationAddress: '12 Allen Avenue, Ikeja, Lagos',
              stationName: 'IKEJA ALLEN',
            }),
            createShippingQuote({
              displayName: 'GIG Logistics - Pickup at LEKKI BADORE',
              id: 'badore-station',
              isStationPickup: true,
              provider: 'GIGL',
              stationAddress: 'Badore Road, Ajah, Lagos',
              stationName: 'LEKKI BADORE',
            }),
          ],
        },
      }),
      ok: true,
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const setShippingQuotes = jest.fn();

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Ikeja',
      customer: null,
      deliveryPreference: 'pickup_station',
      items: [createCartItem()],
      quoteContextKey: 'Lagos|Ikeja',
      setIsLoadingQuotes: jest.fn(),
      setResolvedShippingQuoteContextKey: jest.fn(),
      setSelectedQuoteId: jest.fn(),
      setShippingQuotes,
      shouldResetSelection: true,
      state: 'Lagos',
      watchedAddress: 'Opebi Road, Ikeja, Lagos',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    expect(setShippingQuotes).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'ikeja-station' }),
    ]);
  });

  it('does not treat a partial city token as a pickup-station match', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        quotes: {
          all: [
            createShippingQuote({
              id: 'ojota-station',
              isStationPickup: true,
              provider: 'GIGL',
              stationName: 'OJOTA',
            }),
            createShippingQuote({
              id: 'ikeja-station',
              isStationPickup: true,
              provider: 'GIGL',
              stationName: 'IKEJA',
            }),
          ],
        },
      }),
      ok: true,
    } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const setShippingQuotes = jest.fn();

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Ojo',
      customer: null,
      deliveryPreference: 'pickup_station',
      items: [createCartItem()],
      quoteContextKey: 'Lagos|Ojo',
      setIsLoadingQuotes: jest.fn(),
      setResolvedShippingQuoteContextKey: jest.fn(),
      setSelectedQuoteId: jest.fn(),
      setShippingQuotes,
      shouldResetSelection: true,
      state: 'Lagos',
      watchedAddress: 'Ojo, Lagos',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    expect(setShippingQuotes).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'ojota-station' }),
      expect.objectContaining({ id: 'ikeja-station' }),
    ]);
  });

  it('clears quotes when request fails and selection reset is required', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
    })) as unknown as typeof fetch;

    const setIsLoadingQuotes = jest.fn();
    const setSelectedQuoteId = jest.fn();
    const setResolvedShippingQuoteContextKey = jest.fn();
    const setShippingQuotes = jest.fn();

    await fetchShippingQuotes({
      apiUrl: 'https://example.com',
      city: 'Lagos',
      customer: null,
      items: [createCartItem()],
      quoteContextKey: 'Lagos|Lagos',
      setIsLoadingQuotes,
      setResolvedShippingQuoteContextKey,
      setSelectedQuoteId,
      setShippingQuotes,
      shouldResetSelection: true,
      state: 'Lagos',
      watchedAddress: '1 Marina',
      watchedEmail: 'ada@example.com',
      watchedFirstName: 'Ada',
      watchedLastName: 'Lovelace',
      watchedPhone: '08031234567',
    });

    expect(setShippingQuotes).toHaveBeenCalledWith([]);
    expect(setSelectedQuoteId).toHaveBeenCalledWith('');
    expect(setResolvedShippingQuoteContextKey).toHaveBeenCalledWith('');
    expect(setIsLoadingQuotes).toHaveBeenLastCalledWith(false);
  });
});
