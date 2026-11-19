import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { shouldReleaseBookingLock } from '../order-shipment-booking-lock-errors';
import { GiglApiClient } from './gigl.auth';
import { bookGiglInternationalShipment } from './gigl.international.booking';
import { baseUrl, bookingRequest } from './gigl.test-helpers';

describe('bugfix: international GIG deadline expiring before the create POST', () => {
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

  it('frees the booking lock when authentication times out before anything was submitted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'TimeoutError';
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    vi.spyOn(GiglApiClient.prototype, 'getApiToken').mockRejectedValue(
      abortError
    );
    const log = vi.fn();
    const safeFetch = (
      url: string,
      options?: RequestInit & { timeout?: number }
    ) => fetch(url, options);
    const apiClient = new GiglApiClient({ safeFetch, log });

    const error = await bookGiglInternationalShipment(
      apiClient,
      { safeFetch, log },
      {
        ...bookingRequest,
        providerRateId: 'GIGL_INTL_2_0_0_1',
        items: [
          {
            ...bookingRequest.items[0],
            height: 6,
            hsCode: '851712',
            length: 10,
            width: 8,
          },
        ],
      }
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'GIGL_BOOKING_TIMED_OUT_BEFORE_SUBMIT',
    });
    expect(shouldReleaseBookingLock(error)).toBe(true);
  });
});
