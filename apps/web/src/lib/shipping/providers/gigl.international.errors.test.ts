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
  internationalCountriesResponse,
  jsonResponse,
  loginResponseWithoutCustomerType,
  quoteRequest,
} from './gigl.test-helpers';

function buildHarness() {
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
          generateQuoteId: () => 'intl-quote-1',
          getQuoteExpiry: (hours = 1) =>
            new Date(Date.now() + hours * 60 * 60 * 1000),
        },
        {
          ...quoteRequest,
          shipmentType: 'international',
          receiver: {
            ...quoteRequest.receiver,
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
        }
      ),
    log,
  };
}

describe('GiglProvider international quote errors', () => {
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

  it('returns no quotes when the international price endpoint fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { message: 'Provider unavailable', status: 503, data: [] },
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const provider = buildHarness();

    await expect(provider.getQuotes()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns no quotes when the international price fetch throws', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockRejectedValueOnce(new Error('network unavailable'));

    const provider = buildHarness();

    await expect(provider.getQuotes()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps valid international rates when another rate is malformed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            message: 'Success',
            status: 200,
            data: [
              {
                GrandTotal: 'not-a-number',
                LogisticCompany: 0,
                ShipmentMethod: 0,
                DeliveryType: 2,
              },
              {
                GrandTotal: 95_000,
                LogisticCompany: 1,
                ShipmentMethod: 3,
                DeliveryType: 2,
              },
            ],
          },
        })
      );

    const provider = buildHarness();
    const quotes = await provider.getQuotes();

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      price: 104_500,
      providerCost: 95_000,
      platformMargin: 9_500,
      marginBasisPoints: 1000,
      pricingVersion: 'gigl_platform_margin_v1',
      providerRateId: 'GIGL_INTL_2_1_3_1',
    });
  });
});
