import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.test';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { quoteProviderFailure } from '../quote-provider-failure';
import { GiglApiClient } from './gigl.auth';
import { getGiglQuotes } from './gigl.quotes';
import { GiglStationsService } from './gigl.stations';
import {
  jsonResponse,
  loginResponse,
  priceResponse,
  quoteRequest,
  serviceCentresResponse,
  stationsResponse,
} from './gigl.test-helpers';

function harness(
  validation: () => Response | Promise<Response>,
  homeFails = false
) {
  const safeFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/login')) return jsonResponse(loginResponse);
    if (url.endsWith('/lga/validateAddress')) return validation();
    if (url.endsWith('/price/v3')) {
      const body = JSON.parse(String(init?.body));
      return homeFails && body.PickUpOptions === 0
        ? new Response(null, { status: 503 })
        : jsonResponse(priceResponse);
    }
    if (url.includes('/serviceCentresByStation?'))
      return jsonResponse(serviceCentresResponse);
    if (url.endsWith('/localstations/get'))
      return jsonResponse(stationsResponse);
    throw new Error(`Unexpected mocked request: ${url}`);
  });
  const log = vi.fn();
  const apiClient = new GiglApiClient({ safeFetch, log });
  let quoteId = 0;
  return {
    safeFetch,
    getQuotes: (request = quoteRequest) =>
      getGiglQuotes(
        apiClient,
        new GiglStationsService(apiClient),
        {
          safeFetch,
          log,
          generateQuoteId: () => `quote-${++quoteId}`,
          getQuoteExpiry: () => new Date(),
        },
        request
      ),
  };
}

function coverageResponse(HomeDeliveryStatus: boolean) {
  return jsonResponse({
    status: '200',
    message: 'Address validation completed.',
    data: {
      LGAId: '1',
      LGAName: 'Test LGA',
      LGAState: 'Rivers',
      HomeDeliveryStatus,
    },
  });
}

beforeEach(() => vi.stubEnv('GIGL_ADDRESS_VALIDATION_ENABLED', 'true'));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GIGL address coverage before domestic pricing', () => {
  it.each([
    undefined,
    'false',
  ])('does not activate new validation requests when flag is %j', async (flag) => {
    vi.stubEnv('GIGL_ADDRESS_VALIDATION_ENABLED', flag);
    const { getQuotes, safeFetch } = harness(() => coverageResponse(true));
    const quotes = await getQuotes();
    expect(quotes.some((quote) => !quote.isStationPickup)).toBe(true);
    expect(
      quotes.every((quote) => quote.homeDeliveryCoverage === undefined)
    ).toBe(true);
    expect(
      safeFetch.mock.calls.some(([url]) => url.endsWith('/lga/validateAddress'))
    ).toBe(false);
  });
  it('validates the actual destination and permits home quotes only on explicit coverage', async () => {
    const { getQuotes, safeFetch } = harness(() => coverageResponse(true));
    const quotes = await getQuotes();
    expect(quotes.some((quote) => !quote.isStationPickup)).toBe(true);
    expect(
      quotes.every((quote) => quote.homeDeliveryCoverage === 'supported')
    ).toBe(true);
    const validations = safeFetch.mock.calls.filter(([url]) =>
      url.endsWith('/lga/validateAddress')
    );
    expect(validations).toHaveLength(1);
    expect(JSON.parse(String(validations[0][1]?.body))).toEqual({
      Latitude: 4.8156,
      Longitude: 7.0498,
    });
  });

  it('offers pickup without requesting home prices when GIG explicitly says false', async () => {
    const { getQuotes, safeFetch } = harness(() => coverageResponse(false));
    const quotes = await getQuotes();
    expect(quotes.length).toBeGreaterThan(0);
    expect(
      quotes.every(
        (quote) =>
          quote.isStationPickup && quote.homeDeliveryCoverage === 'unsupported'
      )
    ).toBe(true);
    const prices = safeFetch.mock.calls.filter(([url]) =>
      url.endsWith('/price/v3')
    );
    expect(
      prices.every(
        ([, init]) => JSON.parse(String(init?.body)).PickUpOptions === 1
      )
    ).toBe(true);
  });

  it.each([
    ['missing status', () => jsonResponse({ status: '200', data: {} })],
    [
      'string boolean',
      () =>
        jsonResponse({ status: '200', data: { HomeDeliveryStatus: 'false' } }),
    ],
    ['HTTP 401', () => new Response(null, { status: 401 })],
    [
      'ambiguous LGA 401',
      () =>
        jsonResponse({
          status: '401',
          message: 'We could not match this address to a supported LGA.',
          data: {},
        }),
    ],
    ['provider outage', () => new Response(null, { status: 503 })],
    ['network error', () => Promise.reject(new Error('Network unavailable'))],
  ])('keeps %s inconclusive and does not claim no coverage', async (_name, response) => {
    const { getQuotes } = harness(response);
    const quotes = await getQuotes();
    expect(quotes.length).toBeGreaterThan(0);
    expect(
      quotes.every(
        (quote) =>
          quote.isStationPickup && quote.homeDeliveryCoverage === 'unavailable'
      )
    ).toBe(true);
  });

  it('retains confirmed coverage when home pricing fails and pickup still succeeds', async () => {
    const { getQuotes } = harness(() => coverageResponse(true), true);
    const quotes = await getQuotes();
    expect(quotes.length).toBeGreaterThan(0);
    expect(
      quotes.every(
        (quote) =>
          quote.isStationPickup && quote.homeDeliveryCoverage === 'supported'
      )
    ).toBe(true);
  });

  it.each([
    [undefined, undefined],
    [0, 0],
    [Number.NaN, 7],
    [51.5, -0.1],
  ])('rejects missing or invalid destination pins (%s, %s) without provider calls', async (latitude, longitude) => {
    const { getQuotes, safeFetch } = harness(() => coverageResponse(true));
    const quotes = await getQuotes({
      ...quoteRequest,
      receiver: { ...quoteRequest.receiver, latitude, longitude },
    });
    expect(quotes).toEqual([]);
    expect(quoteProviderFailure.get(quotes)?.message).toMatch(
      /destination location/i
    );
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
