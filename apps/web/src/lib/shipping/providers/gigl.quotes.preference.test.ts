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
import {
  baseUrl,
  jsonResponse,
  loginResponse,
  priceResponse,
  quoteRequest,
  serviceCentresResponse,
  stationsResponse,
} from './gigl.test-helpers';

function mockGiglFetchSequence(...responses: Response[]) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const nextResponse = responses.shift();
    if (!nextResponse) {
      throw new Error(`Unexpected GIGL fetch: ${url}`);
    }
    return nextResponse;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildQuoteHarness() {
  const log = vi.fn();
  const safeFetch = (
    url: string,
    options?: RequestInit & { timeout?: number }
  ) => fetch(url, options);
  const apiClient = new GiglApiClient({ safeFetch, log });
  const stationsService = new GiglStationsService(apiClient);

  return {
    getQuotes: () =>
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
        { ...quoteRequest, deliveryPreference: 'pickup_station' }
      ),
  };
}

describe('GiglProvider quote delivery preference', () => {
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

  it('requests only station-pickup pricing when the quote asks for pickup stations', async () => {
    const resolutionSpy = vi.spyOn(
      GiglStationsService.prototype,
      'resolveStationForLocation'
    );
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(serviceCentresResponse)
    );

    const quotes = await buildQuoteHarness().getQuotes();

    expect(quotes).toHaveLength(6);
    expect(quotes[0]).toMatchObject({
      provider: 'GIGL',
      serviceTier: 'Station Pickup - GoStandard',
      providerRateId: 'GIGL_30_1_1_575_0_4',
      isStationPickup: true,
      stationName: 'PHC RUMUOLUMENI IWOFE',
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${baseUrl}/login`,
      `${baseUrl}/localstations/get`,
      `${baseUrl}/price/v3`,
      `${baseUrl}/price/v3`,
      `${baseUrl}/serviceCentresByStation?StationId=30`,
    ]);
    const pricePayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(pricePayload.PickUpOptions).toBe(1);
    expect(resolutionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 4.8156, longitude: 7.0498 }),
      expect.objectContaining({ preferNearest: true })
    );
  });
});
