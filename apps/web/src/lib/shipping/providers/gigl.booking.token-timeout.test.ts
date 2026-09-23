import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { GiglApiClient } from './gigl.auth';
import { bookGiglShipment } from './gigl.booking';
import { GiglStationsService } from './gigl.stations';
import { baseUrl, bookingRequest } from './gigl.test-helpers';

describe('GiglProvider token-acquisition timeouts', () => {
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

  it('bugfix: classifies token-acquisition timeouts as pre-provider errors', async () => {
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
    const stationsService = new GiglStationsService(apiClient);

    await expect(
      bookGiglShipment(
        apiClient,
        stationsService,
        { safeFetch, log },
        bookingRequest
      )
    ).rejects.toMatchObject({
      code: 'GIGL_AUTHENTICATION_FAILED',
      message: 'GIGL API authentication timed out',
    });
  });
});
