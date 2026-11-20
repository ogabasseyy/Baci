import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('bugfix: Topship save-shipment refusals and the booking lock', () => {
  beforeEach(() => {
    process.env.TOPSHIP_API_KEY = 'test-api-key';
    process.env.TOPSHIP_USE_SANDBOX = 'true';
    process.env.TOPSHIP_SANDBOX_URL = 'https://topship-staging.africa/api';
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.TOPSHIP_API_KEY;
    delete process.env.TOPSHIP_USE_SANDBOX;
    delete process.env.TOPSHIP_SANDBOX_URL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function bookWithSaveStatus(status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid address' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const { TopshipProvider } = await import('./topship');
    const error = await new TopshipProvider()
      .bookShipment(request)
      .catch((e: unknown) => e);
    // Load after the module reset so the error classes are the same instances.
    const { shouldReleaseBookingLock } = await import(
      '@/lib/shipping/order-shipment-booking-lock-errors'
    );
    return { error, release: shouldReleaseBookingLock(error) };
  }

  it('frees the lock and shows the reason when Topship refuses the save (4xx)', async () => {
    const { error, release } = await bookWithSaveStatus(400);
    expect(error).toMatchObject({
      code: 'TOPSHIP_SAVE_REJECTED',
      message: 'Invalid address',
    });
    expect(release).toBe(true);
  });

  it('keeps the lock when Topship answers the save with a 5xx (it may have been created)', async () => {
    const { error, release } = await bookWithSaveStatus(500);
    const { classifyBookingFailure } = await import(
      './../classify-booking-failure'
    );
    expect(classifyBookingFailure(error).outcome).toBe('provider_unconfirmed');
    expect(release).toBe(false);
  });

  it('bugfix: a malformed 2xx save-shipment body is unconfirmed and keeps the lock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: 'shape' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const { TopshipProvider } = await import('./topship');
    const error = await new TopshipProvider()
      .bookShipment(request)
      .catch((e: unknown) => e);
    const { classifyBookingFailure } = await import(
      './../classify-booking-failure'
    );
    const { shouldReleaseBookingLock } = await import(
      '@/lib/shipping/order-shipment-booking-lock-errors'
    );
    expect(classifyBookingFailure(error).outcome).toBe('provider_unconfirmed');
    expect(shouldReleaseBookingLock(error)).toBe(false);
  });

  it('bugfix: a save-shipment body read failure on a 2xx answer is unconfirmed and keeps the lock', async () => {
    const brokenBody = new Response('{}', { status: 200 });
    vi.spyOn(brokenBody, 'text').mockRejectedValue(new TypeError('terminated'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenBody));
    const { TopshipProvider } = await import('./topship');
    const error = await new TopshipProvider()
      .bookShipment(request)
      .catch((e: unknown) => e);
    const { classifyBookingFailure } = await import(
      './../classify-booking-failure'
    );
    const { shouldReleaseBookingLock } = await import(
      '@/lib/shipping/order-shipment-booking-lock-errors'
    );
    expect(classifyBookingFailure(error).outcome).toBe('provider_unconfirmed');
    expect(shouldReleaseBookingLock(error)).toBe(false);
  });
});
