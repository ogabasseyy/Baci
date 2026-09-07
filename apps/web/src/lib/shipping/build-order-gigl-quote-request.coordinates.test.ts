import { describe, expect, it } from 'vitest';
import { buildOrderGiglQuoteRequest } from './build-order-gigl-quote-request';

const sender = {
  name: 'Store',
  phone: '0800',
  address: 'Origin',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

const base = {
  id: 'o1',
  customer_name: 'Ada',
  customer_phone: '081',
  shipping_address: {
    address: 'Dest',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  order_items: [
    { name: 'iPhone 15', quantity: 1, price: 500000, product_id: 'p1' },
  ],
};

function googleOrder(overrides: Record<string, unknown>) {
  return {
    ...base,
    shipping_address: {
      address: 'Stored Google destination',
      phone: '08123456789',
      country: 'Nigeria',
      countryCode: 'NG',
      latitude: 6.6018,
      longitude: 3.3515,
      ...overrides,
    },
  };
}

describe('buildOrderGiglQuoteRequest Google receiver coordinates', () => {
  it('accepts a domestic Google-complete receiver with address, phone, and finite coordinates only', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({
        address: 'Google formatted destination',
        city: undefined,
        state: undefined,
      }),
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        shipmentType: 'domestic',
        receiver: {
          address: 'Google formatted destination',
          phone: '08123456789',
          latitude: 6.6018,
          longitude: 3.3515,
        },
      },
    });
  });

  it('normalizes numeric-string stored coordinates before building the request', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({
        city: undefined,
        state: undefined,
        latitude: '6.6018',
        longitude: '3.3515',
      }),
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        receiver: { latitude: 6.6018, longitude: 3.3515 },
      },
    });
    if (result.ok) {
      expect(typeof result.request.receiver.latitude).toBe('number');
      expect(typeof result.request.receiver.longitude).toBe('number');
    }
  });

  it('does not reuse stored coordinates when a changed address override omits coordinates', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({ city: undefined, state: undefined }),
      sender,
      undefined,
      { address: 'Changed manual destination', phone: '08123456789' }
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
      missing: ['city', 'state'],
    });
  });

  it('preserves stored coordinates for an unchanged address override', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({ city: undefined, state: undefined }),
      sender,
      undefined,
      { address: 'Stored Google destination', phone: '08123456789' }
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        receiver: { latitude: 6.6018, longitude: 3.3515 },
      },
    });
  });

  it('uses a complete new coordinate pair for a changed address override', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({ city: undefined, state: undefined }),
      sender,
      undefined,
      {
        address: 'Changed Google destination',
        phone: '08123456789',
        latitude: 6.5244,
        longitude: 3.3792,
      }
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        receiver: {
          address: 'Changed Google destination',
          latitude: 6.5244,
          longitude: 3.3792,
        },
      },
    });
  });

  it('does not treat out-of-range stored coordinates as Google-complete', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({ city: undefined, state: undefined, latitude: 91 }),
      sender
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
      missing: ['city', 'state'],
    });
  });

  it('still requires city and state for a foreign receiver even when coordinates are present', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({
        city: undefined,
        state: undefined,
        country: 'Canada',
        countryCode: 'CA',
        latitude: 43.6532,
        longitude: -79.3832,
      }),
      sender
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
      missing: ['city', 'state'],
    });
  });

  it('treats blank legacy country fields as a domestic Nigerian address', async () => {
    const result = await buildOrderGiglQuoteRequest(
      googleOrder({
        city: undefined,
        state: undefined,
        country: '',
        countryCode: '',
      }),
      sender
    );

    expect(result).toMatchObject({
      ok: true,
      request: { shipmentType: 'domestic' },
    });
  });
});
