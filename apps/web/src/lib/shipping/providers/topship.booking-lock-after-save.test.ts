import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKED_SHIPMENT_NOT_SAVED_CODE } from '@/lib/shipping/order-shipment-booking-failure';
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

    // The second call must be the payment request for the saved shipment, so
    // an uncoded save-shipment failure cannot satisfy these assertions.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('pay-from-wallet');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      detail: { shipmentId: 'shipment-1' },
    });
    expect(error).toMatchObject({ code: BOOKED_SHIPMENT_NOT_SAVED_CODE });
    expect((error as Error).message).toContain('T1');
    expect(shouldReleaseBookingLock(error)).toBe(false);
  });

  it('bugfix: a response-body read failure after save keeps the lock and carries the tracking id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const brokenBody = new Response('{}', { status: 200 });
    vi.spyOn(brokenBody, 'text').mockRejectedValue(new TypeError('terminated'));
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
      .mockResolvedValueOnce(brokenBody);
    vi.stubGlobal('fetch', fetchMock);

    const { TopshipProvider } = await import('./topship');
    const error = await new TopshipProvider()
      .bookShipment(request)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: BOOKED_SHIPMENT_NOT_SAVED_CODE,
      providerReference: 'T1',
    });
    expect(shouldReleaseBookingLock(error)).toBe(false);
  });

  it('bugfix: a malformed successful pay-from-wallet answer after save is booked-not-saved with the tracking id', async () => {
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: 'shape' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { TopshipProvider } = await import('./topship');
    const error = await new TopshipProvider()
      .bookShipment(request)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: BOOKED_SHIPMENT_NOT_SAVED_CODE,
      providerReference: 'T1',
    });
    expect(shouldReleaseBookingLock(error)).toBe(false);
  });
});
