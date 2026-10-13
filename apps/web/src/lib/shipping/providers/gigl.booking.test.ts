import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { GiglApiClient } from './gigl.auth';
import { bookGiglShipment } from './gigl.booking';
import { GIGL_BOOKING_TIMEOUT_MS } from './gigl.constants';
import { GiglStationsService } from './gigl.stations';
import {
  baseUrl,
  bookingRequest,
  bookingResponse,
  jsonResponse,
  loginResponseWithoutCustomerType,
  stationsResponse,
} from './gigl.test-helpers';

function buildBookingHarness() {
  const log = vi.fn();
  const safeFetch = (
    url: string,
    options?: RequestInit & { timeout?: number }
  ) => fetch(url, options);
  const apiClient = new GiglApiClient({ safeFetch, log });
  const stationsService = new GiglStationsService(apiClient);

  return {
    bookShipment: (request: typeof bookingRequest) =>
      bookGiglShipment(apiClient, stationsService, { safeFetch, log }, request),
  };
}

describe('GiglProvider booking requests', () => {
  beforeEach(() => {
    process.env.GIGL_BASE_URL = baseUrl;
    process.env.GIGL_EMAIL = 'test@example.com';
    process.env.GIGL_PASSWORD = 'test-password';
  });

  afterEach(() => {
    delete process.env.GIGL_BASE_URL;
    delete process.env.GIGL_EMAIL;
    delete process.env.GIGL_PASSWORD;
    delete process.env.GIGL_BOOKING_TIMEOUT_MS;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('books the selected station-pickup quote semantics', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse))
      .mockResolvedValueOnce(jsonResponse(bookingResponse));

    const provider = buildBookingHarness();

    const result = await provider.bookShipment(bookingRequest);

    const bookingPayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(bookingPayload).toMatchObject({
      SenderDetails: {
        SenderLocation: { Latitude: 0, Longitude: 0 },
      },
      ReceiverDetails: {
        ReceiverStationId: 30,
        ReceiverLocation: { Latitude: 0, Longitude: 0 },
      },
      ShipmentDetails: {
        IsPriorityShipment: false,
        PricingStrategy: 3,
        IsCashOnDelivery: false,
        CashOnDeliveryAmount: 0,
        VehicleType: 1,
      },
    });
    expect(bookingPayload.ShipmentDetails).not.toHaveProperty('DeliveryType');
    expect(bookingPayload.ShipmentDetails).not.toHaveProperty('PickupOptions');
    expect(bookingPayload.ShipmentItems[0]).toMatchObject({
      SpecialPackageId: 1,
    });
    const bookingOptions = fetchMock.mock.calls[2]?.[1] as
      | (RequestInit & { timeout?: number })
      | undefined;
    expect(bookingOptions?.timeout).toBe(GIGL_BOOKING_TIMEOUT_MS);
    expect(bookingOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({
      provider: 'GIGL',
      trackingNumber: 'GIGL-WB-1',
      isStationPickup: true,
      pickupStationName: 'PORT HARCOURT',
      pickupStationAddress: 'Port Harcourt station',
    });
  });

  it('preserves GoFaster when booking a priority quote', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse))
      .mockResolvedValueOnce(jsonResponse(bookingResponse));

    const provider = buildBookingHarness();

    await provider.bookShipment({
      ...bookingRequest,
      providerRateId: 'GIGL_30_1_1_0_1',
    });

    const bookingPayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(bookingPayload.ShipmentDetails).toMatchObject({
      IsPriorityShipment: true,
      PricingStrategy: 3,
    });
    expect(bookingPayload.ShipmentDetails).not.toHaveProperty('DeliveryType');
    expect(bookingPayload.ShipmentDetails).not.toHaveProperty('PickupOptions');
  });

  it('preserves the quoted vehicle type during booking', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse))
      .mockResolvedValueOnce(jsonResponse(bookingResponse));

    const provider = buildBookingHarness();

    await provider.bookShipment({
      ...bookingRequest,
      providerRateId: 'GIGL_30_1_2',
    });

    const bookingPayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(bookingPayload.ShipmentDetails.VehicleType).toBe(2);
  });

  it('uses the resolved sender station coordinates when sender coordinates are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const [lagosStation, ...otherStations] = stationsResponse.data.data;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(
        jsonResponse({
          ...stationsResponse,
          data: {
            ...stationsResponse.data,
            data: [
              {
                ...lagosStation,
                Latitude: 6.6001,
                Longitude: 3.5001,
              },
              ...otherStations,
            ],
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse(bookingResponse));

    const provider = buildBookingHarness();

    await provider.bookShipment({
      ...bookingRequest,
      sender: {
        ...bookingRequest.sender,
        latitude: undefined,
        longitude: undefined,
      },
    });

    const bookingPayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(bookingPayload.SenderDetails.SenderLocation).toEqual({
      Latitude: 6.6001,
      Longitude: 3.5001,
    });
  });

  it('does not replay successful booking envelopes with benign auth wording', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            message: 'Authentication token recorded for shipment',
            status: 200,
            data: { Waybill: 'GIGL-WB-1' },
          },
        })
      );

    const provider = buildBookingHarness();

    await expect(provider.bookShipment(bookingRequest)).resolves.toMatchObject({
      trackingNumber: 'GIGL-WB-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects bookings when the sender station cannot be resolved', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse));

    const provider = buildBookingHarness();

    await expect(
      provider.bookShipment({
        ...bookingRequest,
        sender: {
          ...bookingRequest.sender,
          city: 'Asaba',
          state: 'Delta',
        },
      })
    ).rejects.toMatchObject({
      code: 'GIGL_STATION_RESOLUTION_FAILED',
      message: 'No GIGL station found for pickup location',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recomputes heavy legacy bookings with the van vehicle type', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse))
      .mockResolvedValueOnce(jsonResponse(bookingResponse));

    const provider = buildBookingHarness();

    await provider.bookShipment({
      ...bookingRequest,
      providerRateId: 'GIGL_30_1',
      items: [{ ...bookingRequest.items[0], weight: 31 }],
    });

    const bookingPayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(bookingPayload.ShipmentDetails.VehicleType).toBe(2);
  });

  it('rejects station-pickup bookings when the selected station cannot be resolved', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(stationsResponse));

    const provider = buildBookingHarness();

    await expect(
      provider.bookShipment({
        ...bookingRequest,
        providerRateId: 'GIGL_999_1',
      })
    ).rejects.toThrow('Selected GIGL station was not found');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
