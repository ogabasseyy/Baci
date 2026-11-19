import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { quoteProviderFailure } from '../quote-provider-failure';
import { buildHarness } from './gigl.international.test-support';
import {
  baseUrl,
  internationalCountriesResponse,
  jsonResponse,
  loginResponseWithoutCustomerType,
  quoteRequest,
} from './gigl.test-helpers';

describe('GiglProvider international shipments', () => {
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

  it('returns no quotes when the destination country is unsupported', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { message: 'Success', status: 200, data: [] },
        })
      );

    const provider = buildHarness();
    const quotes = await provider.getQuotes({
      ...quoteRequest,
      shipmentType: 'international',
      receiver: {
        ...quoteRequest.receiver,
        address: '1 Unsupported Street',
        city: 'Unknown',
        state: 'Unknown',
        country: 'Atlantis',
        countryCode: 'AT',
      },
    });

    expect(quotes).toEqual([]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${baseUrl}/login`,
      `${baseUrl}/country/get?CountryName=Atlantis`,
    ]);
  });

  it('skips international rates that are missing booking selectors', async () => {
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
                GrandTotal: 114_534.49,
                LogisticCompany: 0,
                DeliveryType: 2,
              },
              {
                GrandTotal: 95_000,
                LogisticCompany: 1,
                ShipmentMethod: 3,
                DeliveryType: 2,
              },
              {
                GrandTotal: 80_000,
                LogisticCompany: 1.5,
                ShipmentMethod: 3,
                DeliveryType: 2,
              },
              {
                GrandTotal: 75_000,
                LogisticCompany: 1,
                ShipmentMethod: -1,
                DeliveryType: 2,
              },
            ],
          },
        })
      );

    const provider = buildHarness();
    const quotes = await provider.getQuotes({
      ...quoteRequest,
      shipmentType: 'international',
      receiver: {
        ...quoteRequest.receiver,
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
      },
    });

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      price: 104_500,
      providerRateId: 'GIGL_INTL_2_1_3_1',
    });
  });

  it('marks a provider failure when every rate lacks booking selectors', async () => {
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
                GrandTotal: 114_534.49,
                LogisticCompany: 0,
                DeliveryType: 2,
              },
              {
                GrandTotal: 95_000,
                LogisticCompany: 1,
                DeliveryType: 2,
              },
            ],
          },
        })
      );

    const provider = buildHarness();
    const quotes = await provider.getQuotes({
      ...quoteRequest,
      shipmentType: 'international',
      receiver: {
        ...quoteRequest.receiver,
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
      },
    });

    expect(quotes).toEqual([]);
    expect(quoteProviderFailure.get(quotes)?.message).toBe(
      'GIGL international rates lacked booking selectors'
    );
  });
});
