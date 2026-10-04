import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { quoteProviderFailure } from '../quote-provider-failure';
import { GiglApiClient } from './gigl.auth';
import { getGiglQuotes } from './gigl.quotes';
import { GiglStationsService } from './gigl.stations';
import {
  baseUrl,
  jsonResponse,
  loginResponse,
  quoteRequest,
  stationsResponse,
} from './gigl.test-helpers';

describe('GIGL domestic quote failures', () => {
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
    vi.unstubAllGlobals();
  });

  it('marks a price-endpoint outage for aggregate diagnostics', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(loginResponse))
        .mockResolvedValueOnce(jsonResponse(stationsResponse))
        .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
        .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    );
    const log = vi.fn();
    const safeFetch = (url: string, options?: RequestInit) =>
      fetch(url, options);
    const apiClient = new GiglApiClient({ safeFetch, log });
    const stationsService = new GiglStationsService(apiClient);

    const result = await getGiglQuotes(
      apiClient,
      stationsService,
      {
        safeFetch,
        log,
        generateQuoteId: () => 'quote-1',
        getQuoteExpiry: () => new Date(),
      },
      quoteRequest
    );

    expect(result).toEqual([]);
    expect(quoteProviderFailure.get(result)?.message).toBe(
      'GIGL quote request failed (503)'
    );
  });
});
