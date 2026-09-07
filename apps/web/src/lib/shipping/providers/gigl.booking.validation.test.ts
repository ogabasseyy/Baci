import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import type { OrderShipmentBookingError } from '../order-shipment-booking-utils';
import { GiglApiClient } from './gigl.auth';
import { bookGiglShipment } from './gigl.booking';
import { GIGL_BOOKING_TIMEOUT_MS } from './gigl.constants';
import { GiglStationsService } from './gigl.stations';
import {
  baseUrl,
  bookingRequest,
  jsonResponse,
  loginResponseWithoutCustomerType,
  stationsResponse,
} from './gigl.test-helpers';

function buildBookingHarness() {
  const log = vi.fn();
  const safeFetch = (
    url: string,
    options?: RequestInit & { timeout?: number }
  ) => fetch(url, options);
  const apiClient = new GiglApiClient({ safeFetch, log });
  const stationsService = new GiglStationsService(apiClient);

  return {
    bookShipment: (request: typeof bookingRequest) =>
      bookGiglShipment(apiClient, stationsService, { safeFetch, log }, request),
  };
}

describe('GIGL booking validation and timeout regressions', () => {
  beforeEach(() => {
    process.env.GIGL_BASE_URL = baseUrl;
    process.env.GIGL_EMAIL = 'test@example.com';
    process.env.GIGL_PASSWORD = 'test-password';
  });

  afterEach(() => {
    delete process.env.GIGL_BASE_URL;
    delete process.env.GIGL_EMAIL;
    delete process.env.GIGL_PASSWORD;
    delete process.env.GIGL_BOOKING_TIMEOUT_MS;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('marks GIGL validation rejections as safe to retry before a waybill is created', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: '"ShipmentDetails.IsCashOnDelivery" must be a boolean',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const provider = buildBookingHarness();

    await expect(provider.bookShipment(bookingRequest)).rejects.toMatchObject({
      code: 'GIGL_BOOKING_VALIDATION_FAILED',
      status: 400,
    } satisfies Partial<OrderShipmentBookingError>);
  });

  it('bounds slow booking token fetches with the GIGL booking timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    const provider = buildBookingHarness();
    const bookingPromise = provider.bookShipment(bookingRequest);
    const bookingAssertion = expect(bookingPromise).rejects.toThrow(
      'GIGL API authentication timed out'
    );

    await vi.advanceTimersByTimeAsync(GIGL_BOOKING_TIMEOUT_MS);

    await bookingAssertion;
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/login`,
      expect.objectContaining({ method: 'POST' })
    );
  });
});
