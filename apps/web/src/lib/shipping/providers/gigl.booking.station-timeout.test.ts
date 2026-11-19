import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { shouldReleaseBookingLock } from '../order-shipment-booking-lock-errors';
import { GiglApiClient } from './gigl.auth';
import { bookGiglShipment } from './gigl.booking';
import type { GiglStationsService } from './gigl.stations';
import { baseUrl, bookingRequest } from './gigl.test-helpers';

describe('bugfix: GIG deadline expiring before the booking POST is sent', () => {
  beforeEach(() => {
    process.env.GIGL_BASE_URL = baseUrl;
    process.env.GIGL_EMAIL = 'test@example.com';
    process.env.GIGL_PASSWORD = 'test-password';
  });

  afterEach(() => {
    delete process.env.GIGL_BASE_URL;
    delete process.env.GIGL_EMAIL;
    delete process.env.GIGL_PASSWORD;
    vi.restoreAllMocks();
  });

  it('frees the booking lock when a station lookup times out before anything was submitted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'TimeoutError';
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    vi.spyOn(GiglApiClient.prototype, 'getApiToken').mockResolvedValue({
      access_token: 'token',
    } as never);
    const log = vi.fn();
    const safeFetch = (
      url: string,
      options?: RequestInit & { timeout?: number }
    ) => fetch(url, options);
    const apiClient = new GiglApiClient({ safeFetch, log });
    const stationsService = new Proxy(
      {},
      { get: () => vi.fn().mockRejectedValue(abortError) }
    ) as unknown as GiglStationsService;

    const error = await bookGiglShipment(
      apiClient,
      stationsService,
      { safeFetch, log },
      bookingRequest
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'GIGL_BOOKING_TIMED_OUT_BEFORE_SUBMIT',
    });
    expect(shouldReleaseBookingLock(error)).toBe(true);
  });
});
