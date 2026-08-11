import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { GiglApiClient } from './gigl.auth';
import { getGiglQuotes } from './gigl.quotes';
import { GiglStationsService } from './gigl.stations';
import { quoteProviderFailure } from '../quote-provider-failure';
import {
  baseUrl,
  failedStationsEnvelope,
  jsonResponse,
  loginResponse,
  loginResponseWithoutCustomerType,
  priceResponse,
  quoteRequest,
  serviceCentresResponse,
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
    if (!nextResponse) throw new Error(`Unexpected GIGL fetch: ${url}`);
    return typeof nextResponse === 'function'
      ? nextResponse(url, init)
      : nextResponse;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildQuoteHarness(generateQuoteId?: () => string) {
  const log = vi.fn();
  const safeFetch = (
    url: string,
    options?: RequestInit & { timeout?: number }
  ) => fetch(url, options);
  const apiClient = new GiglApiClient({ safeFetch, log });
  const stationsService = new GiglStationsService(apiClient);
  const quoteIds = ['quote-1', 'quote-2', 'quote-3', 'quote-4'];

  return {
    getQuotes: (request: typeof quoteRequest) =>
      getGiglQuotes(
        apiClient,
        stationsService,
        {
          safeFetch,
          log,
          generateQuoteId:
            generateQuoteId ?? (() => quoteIds.shift() ?? 'quote-fallback'),
          getQuoteExpiry: (hours = 1) =>
            new Date(Date.now() + hours * 60 * 60 * 1000),
        },
        request
      ),
  };
}

describe('GiglProvider quote requests', () => {
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

  it('keeps station-pickup fallback when only GoFaster home delivery succeeds', async () => {
    mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      jsonResponse({
        success: true,
        data: { message: 'GoStandard unavailable', status: 503, data: null },
      }),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse({
        success: true,
        data: {
          message: 'GoFaster pickup unavailable',
          status: 503,
          data: null,
        },
      }),
      jsonResponse(serviceCentresResponse)
    );

    const quotes = await buildQuoteHarness().getQuotes(quoteRequest);

    expect(quotes.some((quote) => quote.serviceTier === 'GoFaster')).toBe(true);
    expect(quotes.some((quote) => quote.isStationPickup)).toBe(true);
  });

  it('preserves home delivery when the service-centre request throws', async () => {
    mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      () => Promise.reject(new Error('service-centre pricing unavailable'))
    );

    const quotes = await buildQuoteHarness().getQuotes(quoteRequest);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      isStationPickup: false,
      providerRateId: 'GIGL_30_0_1_0_0_4',
    });
  });

  it('preserves a pickup quote when service-centre expansion throws', async () => {
    mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(serviceCentresResponse)
    );
    const generateQuoteId = vi
      .fn<() => string>()
      .mockReturnValueOnce('base-station-quote')
      .mockImplementation(() => {
        throw new Error('quote id unavailable');
      });

    const quotes = await buildQuoteHarness(generateQuoteId).getQuotes({
      ...quoteRequest,
      deliveryPreference: 'pickup_station',
    });

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      id: 'base-station-quote',
      isStationPickup: true,
      providerRateId: 'GIGL_30_1_1_0_0_4',
    });
  });

  it('falls back to UserChannelType when CustomerType is absent', async () => {
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponseWithoutCustomerType),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse)
    );

    const provider = buildQuoteHarness();

    const quotes = await provider.getQuotes(quoteRequest);

    expect(quotes).toHaveLength(2);
    const pricePayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(pricePayload).not.toHaveProperty('CustomerType');
  });

  it('does not cache a failed station envelope as an empty station list', async () => {
    mockGiglFetchSequence(
      jsonResponse(loginResponseWithoutCustomerType),
      jsonResponse(failedStationsEnvelope),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse)
    );

    const provider = buildQuoteHarness();

    await expect(provider.getQuotes(quoteRequest)).resolves.toEqual([]);
    await expect(provider.getQuotes(quoteRequest)).resolves.toHaveLength(2);
  });

  it('skips GIGL quotes when the sender station cannot be resolved', async () => {
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponseWithoutCustomerType),
      jsonResponse(stationsResponse)
    );

    const provider = buildQuoteHarness();
    if (!quoteRequest.sender) {
      throw new Error('Quote fixture must include sender details');
    }

    await expect(
      provider.getQuotes({
        ...quoteRequest,
        sender: {
          ...quoteRequest.sender,
          city: 'Asaba',
          state: 'Delta',
        },
      })
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed price envelopes with schema validation', async () => {
    mockGiglFetchSequence(
      jsonResponse(loginResponseWithoutCustomerType),
      jsonResponse(stationsResponse),
      jsonResponse({
        success: true,
        data: { message: 'Success', status: 200, data: { GrandTotal: 'x' } },
      }),
      jsonResponse({
        success: true,
        data: { message: 'Success', status: 200, data: { GrandTotal: 'x' } },
      })
    );

    const provider = buildQuoteHarness();

    await expect(provider.getQuotes(quoteRequest)).resolves.toEqual([]);
  });

  it('rejects zero-value GIGL prices as unpriced routes', async () => {
    mockGiglFetchSequence(
      jsonResponse(loginResponseWithoutCustomerType),
      jsonResponse(stationsResponse),
      jsonResponse({
        success: true,
        data: {
          message: 'Success',
          status: 200,
          data: { GrandTotal: 0 },
        },
      }),
      jsonResponse({
        success: true,
        data: {
          message: 'Success',
          status: 200,
          data: { GrandTotal: 0 },
        },
      })
    );

    const provider = buildQuoteHarness();

    await expect(provider.getQuotes(quoteRequest)).resolves.toEqual([]);
  });

  it('marks a domestic GIGL request failure for aggregate diagnostics', async () => {
    mockGiglFetchSequence(() => Promise.reject(new Error('login unavailable')));

    const provider = buildQuoteHarness();
    const result = await provider.getQuotes(quoteRequest);

    expect(result).toEqual([]);
    expect(quoteProviderFailure.get(result)?.message).toBe('login unavailable');
  });
});
