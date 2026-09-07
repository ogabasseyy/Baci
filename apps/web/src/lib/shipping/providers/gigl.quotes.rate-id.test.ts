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

function buildQuoteHarness() {
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
          generateQuoteId: () => quoteIds.shift() ?? 'quote-fallback',
          getQuoteExpiry: (hours = 1) =>
            new Date(Date.now() + hours * 60 * 60 * 1000),
        },
        request
      ),
  };
}

describe('GiglProvider quote rate IDs', () => {
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

  it('encodes delivery priority and sender station in home-delivery rate IDs', async () => {
    const resolutionSpy = vi.spyOn(
      GiglStationsService.prototype,
      'resolveStationForLocation'
    );
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse)
    );

    const quotes = await buildQuoteHarness().getQuotes(quoteRequest);

    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      provider: 'GIGL',
      serviceTier: 'GoStandard',
      carrierName: 'GIG Logistics',
      price: 9835.58,
      providerCost: 8941.43,
      platformMargin: 894.15,
      marginBasisPoints: 1000,
      pricingVersion: 'gigl_platform_margin_v1',
      currency: 'NGN',
      providerRateId: 'GIGL_30_0_1_0_0_4',
    });
    expect(quotes[1]).toMatchObject({
      serviceTier: 'GoFaster',
      providerRateId: 'GIGL_30_0_1_0_1_4',
    });
    expect(quotes.some((quote) => quote.isStationPickup)).toBe(false);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${baseUrl}/login`,
      `${baseUrl}/localstations/get`,
      `${baseUrl}/price/v3`,
      `${baseUrl}/price/v3`,
      `${baseUrl}/price/v3`,
      `${baseUrl}/price/v3`,
    ]);

    const pricePayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(pricePayload).toMatchObject({
      SenderStationId: 4,
      ReceiverStationId: 30,
      PickUpOptions: 0,
      VehicleType: 1,
      IsPriorityShipment: false,
    });
    expect(pricePayload.ShipmentItems[0]).toMatchObject({
      SpecialPackageId: 1,
    });
    expect(pricePayload.ShipmentItems[0]).not.toHaveProperty('ItemType');
    expect(pricePayload).not.toHaveProperty('ShipmentType');
    const goFasterPayload = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body ?? '{}')
    );
    expect(goFasterPayload).toMatchObject({
      PickUpOptions: 0,
      IsPriorityShipment: true,
    });
    expect(pricePayload).not.toHaveProperty('CustomerCode');
    expect(pricePayload).not.toHaveProperty('CustomerType');
    expect(
      resolutionSpy.mock.calls.map((call) => call[1]?.preferNearest)
    ).toEqual([false]);
  });

  it('encodes the service centre and sender station in pickup rate IDs', async () => {
    const resolutionSpy = vi.spyOn(
      GiglStationsService.prototype,
      'resolveStationForLocation'
    );
    mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      jsonResponse({
        success: true,
        data: { message: 'Home delivery unavailable', status: 503, data: null },
      }),
      jsonResponse({
        success: true,
        data: { message: 'Home delivery unavailable', status: 503, data: null },
      }),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      jsonResponse(serviceCentresResponse)
    );

    const quotes = await buildQuoteHarness().getQuotes(quoteRequest);

    expect(quotes).toHaveLength(6);
    expect(quotes[0]).toMatchObject({
      provider: 'GIGL',
      serviceTier: 'Station Pickup - GoStandard',
      displayName:
        'GIG Logistics - Pickup at PHC RUMUOLUMENI IWOFE - GoStandard',
      providerRateId: 'GIGL_30_1_1_575_0_4',
      isStationPickup: true,
      stationId: 30,
      stationName: 'PHC RUMUOLUMENI IWOFE',
      stationCode: 'RUM',
      pickupStationCode: 'RUM',
      deliveryRange: '1-3 working days',
      minDays: 1,
      maxDays: 3,
    });
    expect(
      resolutionSpy.mock.calls.map((call) => call[1]?.preferNearest)
    ).toEqual([false, true]);
  });

  it('encodes the van vehicle type for heavy quotes', async () => {
    const fetchMock = mockGiglFetchSequence(
      jsonResponse(loginResponseWithoutCustomerType),
      jsonResponse(stationsResponse),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse)
    );

    const quotes = await buildQuoteHarness().getQuotes({
      ...quoteRequest,
      items: [{ ...quoteRequest.items[0], weight: 31 }],
    });

    expect(quotes.map((quote) => quote.providerRateId)).toEqual([
      'GIGL_30_0_2_0_0_4',
      'GIGL_30_0_2_0_1_4',
    ]);
    const pricePayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(pricePayload.VehicleType).toBe(2);
  });

  it('keeps the quoted station in rate IDs when nearest repricing fails', async () => {
    const portHarcourtStation = {
      StationId: 30,
      StationName: 'PORT HARCOURT',
      StationCode: 'PHC',
      State: 'RIVERS',
      StateName: 'RIVERS',
      City: 'PORT HARCOURT',
      Address: undefined,
      Latitude: undefined,
      Longitude: undefined,
    };
    const lagosStation = {
      ...portHarcourtStation,
      StationId: 4,
      StationName: 'LAGOS',
      StationCode: 'LOS',
      State: 'LAGOS',
      StateName: 'LAGOS',
      City: 'LAGOS',
    };
    vi.spyOn(GiglStationsService.prototype, 'resolveStationForLocation')
      .mockResolvedValueOnce({ station: portHarcourtStation })
      .mockResolvedValueOnce({
        station: lagosStation,
        serviceCentres: [
          {
            StationId: 4,
            StationName: 'LAGOS',
            StationCode: 'LOS',
            ServiceCentreId: 65,
            ServiceCentreName: 'SANGO OTTA',
            ServiceCentreCode: 'SOT',
            Address: undefined,
            Latitude: 6.707,
            Longitude: 3.243,
          },
        ],
      });
    const unavailable = jsonResponse({
      success: true,
      data: { message: 'Unavailable', status: 503, data: null },
    });
    mockGiglFetchSequence(
      jsonResponse(loginResponse),
      jsonResponse(stationsResponse),
      unavailable.clone(),
      unavailable.clone(),
      jsonResponse(priceResponse),
      jsonResponse(priceResponse),
      unavailable.clone(),
      unavailable.clone(),
      jsonResponse(serviceCentresResponse)
    );

    const quotes = await buildQuoteHarness().getQuotes(quoteRequest);

    expect(quotes).not.toHaveLength(0);
    expect(
      quotes.every((quote) => quote.providerRateId?.startsWith('GIGL_30_'))
    ).toBe(true);
    expect(quotes.every((quote) => quote.stationId === 30)).toBe(true);
  });
});
