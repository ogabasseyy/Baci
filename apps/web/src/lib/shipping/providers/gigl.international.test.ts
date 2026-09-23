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

const internationalQuoteResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: [
      {
        GrandTotal: 114_534.49,
        Amount: 100_032.08,
        Currency: '₦',
        LogisticCompany: 0,
        ShipmentMethod: 0,
        DeliveryType: 2,
        EstimatedDeliveryDateAndTime: '2026-07-12T10:45:58.229Z',
        DeclaredValue: 100_000,
      },
    ],
  },
};

function buildHarness() {
  const log = vi.fn();
  const safeFetch = (
    url: string,
    options?: RequestInit & { timeout?: number }
  ) => fetch(url, options);
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
          generateQuoteId: () => 'intl-quote-1',
          getQuoteExpiry: (hours = 1) =>
            new Date(Date.now() + hours * 60 * 60 * 1000),
        },
        request
      ),
  };
}

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

  it('prices outbound international shipments through the GIGL international endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(jsonResponse(internationalQuoteResponse));

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
        postalCode: 'M5V 3L9',
      },
      items: [
        {
          ...quoteRequest.items[0],
          height: 6,
          hsCode: '851712',
          length: 10,
          width: 8,
        },
      ],
    });

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      provider: 'GIGL',
      serviceTier: 'International Express',
      carrierName: 'GIG Logistics',
      displayName: 'GIG Logistics - International Express',
      isStationPickup: false,
      price: 125_987.94,
      providerCost: 114_534.49,
      platformMargin: 11_453.45,
      marginBasisPoints: 1000,
      pricingVersion: 'gigl_platform_margin_v1',
      currency: 'NGN',
      providerRateId: 'GIGL_INTL_2_0_0_1',
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${baseUrl}/login`,
      `${baseUrl}/country/get?CountryName=Canada`,
      `${baseUrl}/intlShipment/price`,
    ]);

    const pricePayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(pricePayload).toMatchObject({
      DestinationCountryId: 36,
      ReceiverCity: 'Toronto',
      ReceiverAddress: '123 Queen Street West',
      ReceiverPostalCode: 'M5V 3L9',
      ReceiverCountryCode: 'CA',
      ReceiverCountry: 'Canada',
      ReceiverStateOrProvinceCode: 'Ontario',
      PickupOptions: 1,
      DeclaredValue: 100_000,
      IsVacuumSeal: false,
      IsPhytosanitaryCertification: false,
    });
    expect(pricePayload.ShipmentItems[0]).toMatchObject({
      InternationalShipmentItemType: 0,
      Description: 'Phone',
      Weight: 1,
      Quantity: 1,
      Value: 100_000,
      HSCode: '851712',
      IsVolumetric: true,
      Length: 10,
      Width: 8,
      Height: 6,
      PackagingType: 1,
    });
    expect(pricePayload.ShipmentPackages[0]).toMatchObject({
      Weight: 1,
      Length: 10,
      Width: 8,
      Height: 6,
    });
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
});
