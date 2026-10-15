import { describe, expect, it } from 'vitest';
import { buildOrderGiglQuoteRequest } from './build-order-gigl-quote-request';
import { resolveRecoveryQuoteReceiver } from './resolve-recovery-quote-receiver';

const receiver = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  latitude: 6.6018,
  longitude: 3.3515,
};

describe('resolveRecoveryQuoteReceiver', () => {
  it('builds a domestic recovery quote despite foreign legacy country metadata', async () => {
    const shippingAddress = {
      ...receiver,
      country: 'Canada',
      countryCode: 'CA',
    };
    const resolved = resolveRecoveryQuoteReceiver(receiver, shippingAddress);
    expect(resolved).toHaveProperty('override');
    if ('error' in resolved) throw new Error(resolved.error);
    const built = await buildOrderGiglQuoteRequest(
      {
        id: 'recovery-order',
        customer_name: 'Customer',
        customer_phone: '08000000000',
        shipping_address: shippingAddress,
        order_items: [{ name: 'Phone', quantity: 1, price: 1000 }],
      },
      {
        name: 'Store',
        phone: '08000000000',
        ...receiver,
        country: 'Nigeria',
        countryCode: 'NG',
      },
      undefined,
      resolved.override
    );
    expect(built).toMatchObject({
      ok: true,
      request: {
        shipmentType: 'domestic',
        receiver: {
          country: 'Nigeria',
          countryCode: 'NG',
          latitude: receiver.latitude,
          longitude: receiver.longitude,
        },
      },
    });
  });
  it.each([
    ['Calabar', 4.95, 8.32],
    ['Uyo', 5.038, 7.928],
    ['Brass', 4.31, 6.24],
    ['Bonny', 4.45, 7.17],
    ['Ngala', 12.34, 14.18],
  ])('accepts a verified pin in %s', (_city, latitude, longitude) => {
    expect(
      resolveRecoveryQuoteReceiver(
        { ...receiver, countryCode: 'NG', latitude, longitude },
        {}
      )
    ).toHaveProperty('override');
  });
  it('replaces both legacy country fields in the validated receiver override', () => {
    expect(
      resolveRecoveryQuoteReceiver(receiver, {
        country: 'Canada',
        countryCode: 'CA',
      })
    ).toEqual({
      override: expect.objectContaining({
        country: 'Nigeria',
        countryCode: 'NG',
      }),
    });
  });
  it('rejects explicit non-Nigerian country codes', () => {
    expect(
      resolveRecoveryQuoteReceiver({ ...receiver, countryCode: 'GH' }, {})
    ).toEqual({ error: 'This recovery supports Nigerian destinations only.' });
  });
  it('rejects manual pins outside Nigeria without a country code', () => {
    const resolved = resolveRecoveryQuoteReceiver(
      { ...receiver, latitude: 40.7128, longitude: -74.006 },
      {}
    );
    expect(resolved).toEqual({
      error:
        'Destination pins must fall within Nigeria. Search for the address to attach its country.',
    });
  });
  it('rejects foreign coordinates paired with an explicit NG country code', () => {
    const resolved = resolveRecoveryQuoteReceiver(
      {
        ...receiver,
        countryCode: 'NG',
        latitude: 40.7128,
        longitude: -74.006,
      },
      {}
    );
    expect(resolved).toEqual({
      error:
        'Destination pins must fall within Nigeria. Search for the address to attach its country.',
    });
  });
  it('rejects Garoua, Cameroon even though a box covering Borno contains it', () => {
    // Garoua (~9.3N 13.4E) falls inside any rectangle covering Borno, so the
    // border polygon (not a bounding box) must reject it.
    const resolved = resolveRecoveryQuoteReceiver(
      { ...receiver, countryCode: 'NG', latitude: 9.3, longitude: 13.4 },
      {}
    );
    expect(resolved).toEqual({
      error:
        'Destination pins must fall within Nigeria. Search for the address to attach its country.',
    });
  });
  it('accepts border-region Nigerian cities (Maiduguri, Sokoto, Yola)', () => {
    for (const pin of [
      { latitude: 11.85, longitude: 13.15 },
      { latitude: 13.06, longitude: 5.24 },
      { latitude: 9.28, longitude: 12.43 },
    ]) {
      expect(resolveRecoveryQuoteReceiver({ ...receiver, ...pin }, {})).toEqual(
        { override: expect.objectContaining({}) }
      );
    }
  });
  it('accepts in-bounds manual pins and carries the legacy postal code', () => {
    const resolved = resolveRecoveryQuoteReceiver(receiver, {
      postal_code: '100001',
    });
    expect(resolved).toEqual({
      override: expect.objectContaining({
        address: expect.stringContaining('12 Test Street'),
        postalCode: '100001',
      }),
    });
  });
  it('prefers an explicit camelCase postal code', () => {
    const resolved = resolveRecoveryQuoteReceiver(
      { ...receiver, countryCode: 'NG' },
      { postalCode: '101002' }
    );
    expect(resolved).toEqual({
      override: expect.objectContaining({ postalCode: '101002' }),
    });
  });
});
