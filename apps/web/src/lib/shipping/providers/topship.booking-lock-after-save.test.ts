import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';
import type { BookingRequest } from '@/lib/shipping/types';

const party = {
  name: 'Test',
  email: 't@example.com',
  phone: '08012345678',
  address: '1 Test Street',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

const request: BookingRequest = {
  orderId: 'order-1',
  quoteId: 'quote-1',
  providerRateId: 'Premium_Express Plus Shipping',
  quoteMetadata: {
    pricingTier: 'Premium',
    serviceType: 'Express Plus Shipping',
    cost: 700000,
  },
  sender: party,
  receiver: { ...party, city: 'Abuja', state: 'FCT' },
  items: [{ name: 'Parcel', quantity: 1, weight: 1, value: 5000 }],
};

describe('bugfix: Topship connection failure after the shipment was saved', () => {
  beforeEach(() => {
    process.env.TOPSHIP_API_KEY = 'test-api-key';
    process.env.TOPSHIP_USE_SANDBOX = 'true';
    process.env.TOPSHIP_SANDBOX_URL = 'https://topship-staging.africa/api';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TOPSHIP_API_KEY;
    delete process.env.TOPSHIP_USE_SANDBOX;
    delete process.env.TOPSHIP_SANDBOX_URL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the booking lock when pay-from-wallet cannot connect after save-shipment succeeded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'shipment-1', trackingId: 'T1', pricingTier: 'Premium' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
          }),
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { TopshipProvider } = await import('./topship');
    const error = await new TopshipProvider()
      .bookShipment(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(shouldReleaseBookingLock(error)).toBe(false);
  });
});
