import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { GiglApiClient } from './gigl.auth';
import { GIGL_QUOTE_TIMEOUT_MS } from './gigl.constants';
import { mockGiglFetchWithCoverage } from './gigl.coverage-test-support';
import { getGiglQuotes } from './gigl.quotes';
import { GiglStationsService } from './gigl.stations';
import {
  abortingFetchResponse,
  baseUrl,
  jsonResponse,
  loginResponseWithToken,
  priceResponse,
  quoteRequest,
  stationsResponse,
} from './gigl.test-helpers';

type FetchResponseFactory = (
  url: string,
  init?: RequestInit
) => Response | Promise<Response>;

function mockGiglFetchSequence(
  ...responses: Array<Response | FetchResponseFactory>
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const nextResponse = responses.shift();
    if (!nextResponse) {
      throw new Error(`Unexpected GIGL fetch: ${url}`);
    }

    return typeof nextResponse === 'function'
      ? nextResponse(url, init)
      : nextResponse;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildQuoteHarness() {
  const log = vi.fn();
  const safeFetch = mockGiglFetchWithCoverage;
  const apiClient = new GiglApiClient({ safeFetch, log });
  const stationsService = new GiglStationsService(apiClient);

  return {
    getQuotes: (request: typeof quoteRequest) =>
      getGiglQuotes(
        apiClient,
        stationsService,
        {
          safeFetch,
          log,
          generateQuoteId: () => 'quote-1',
          getQuoteExpiry: (hours = 1) =>
            new Date(Date.now() + hours * 60 * 60 * 1000),
        },
        request
      ),
  };
}

describe('GiglProvider quote token handling', () => {
  beforeEach(() => {
    process.env.GIGL_BASE_URL = baseUrl;
    process.env.GIGL_EMAIL = 'test@example.com';
    process.env.GIGL_PASSWORD = 'test-password';
  });

  afterEach(() => {
    delete process.env.GIGL_BASE_URL;
    delete process.env.GIGL_EMAIL;
    delete process.env.GIGL_PASSWORD;
    delete process.env.GIGL_QUOTE_TIMEOUT_MS;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes tokens rejected inside successful GIGL envelopes', async () => {
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponseWithToken('old-token')),
      jsonResponse(stationsResponse),
      jsonResponse({
        success: true,
        data: { message: 'Token expired', status: 401, data: null },
      }),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(loginResponseWithToken('new-token')),
      jsonResponse(priceResponse)
    );

    const provider = buildQuoteHarness();

    await expect(provider.getQuotes(quoteRequest)).resolves.toHaveLength(2);

    const oldPriceHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    const stationPriceHeaders = new Headers(
      fetchMock.mock.calls[4]?.[1]?.headers
    );
    const newPriceHeaders = new Headers(fetchMock.mock.calls[7]?.[1]?.headers);
    expect(oldPriceHeaders.get('access-token')).toBe('old-token');
    expect(stationPriceHeaders.get('access-token')).toBe('old-token');
    expect(newPriceHeaders.get('access-token')).toBe('new-token');
    expect(fetchMock.mock.calls[6]?.[0]).toBe(`${baseUrl}/login`);
  });

  it('refreshes cached tokens rejected with HTTP 403', async () => {
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponseWithToken('old-token')),
      new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      jsonResponse(loginResponseWithToken('new-token')),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse)
    );

    const provider = buildQuoteHarness();

    await expect(provider.getQuotes(quoteRequest)).resolves.toHaveLength(2);

    const oldStationHeaders = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers
    );
    const newStationHeaders = new Headers(
      fetchMock.mock.calls[3]?.[1]?.headers
    );
    const priceHeaders = new Headers(fetchMock.mock.calls[4]?.[1]?.headers);
    const stationPriceHeaders = new Headers(
      fetchMock.mock.calls[5]?.[1]?.headers
    );
    expect(oldStationHeaders.get('access-token')).toBe('old-token');
    expect(newStationHeaders.get('access-token')).toBe('new-token');
    expect(priceHeaders.get('access-token')).toBe('new-token');
    expect(stationPriceHeaders.get('access-token')).toBe('new-token');
  });

  it('uses the original quote signal during stale-token refresh', async () => {
    vi.useFakeTimers();
    let resolveUnauthorized: (response: Response) => void = () => undefined;
    const unauthorizedResponse = new Promise<Response>((resolve) => {
      resolveUnauthorized = resolve;
    });
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponseWithToken('old-token')),
      jsonResponse(stationsResponse),
      () => unauthorizedResponse,
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      abortingFetchResponse
    );

    const provider = buildQuoteHarness();
    const quotePromise = provider.getQuotes(quoteRequest);

    resolveUnauthorized(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(GIGL_QUOTE_TIMEOUT_MS);

    await expect(quotePromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceTier: 'GoFaster' }),
      ])
    );
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
