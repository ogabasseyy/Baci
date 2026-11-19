import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
  process.env.GIGL_EMAIL = 'test@example.com';
  process.env.GIGL_PASSWORD = 'test-password';
});

import { classifyBookingFailure } from '../classify-booking-failure';
import { GiglApiClient } from './gigl.auth';
import { bookGiglShipment } from './gigl.booking';
import { isGiglInternationalBookingRequest } from './gigl.international.booking';
import { GiglStationsService } from './gigl.stations';
import {
  baseUrl,
  bookingRequest,
  internationalCountriesResponse,
  jsonResponse,
  loginResponseWithoutCustomerType,
} from './gigl.test-helpers';

const internationalBookingResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: { Waybill: 'GIGL-INTL-1' },
  },
};

const invoiceResponse = {
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: { WaybillLabel: 'https://example.test/gigl-label.pdf' },
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
    bookShipment: (request: typeof bookingRequest) =>
      bookGiglShipment(apiClient, stationsService, { safeFetch, log }, request),
  };
}

describe('GiglProvider international booking', () => {
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

  it('books outbound international shipments with the quoted GIGL rate details', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(jsonResponse(internationalBookingResponse))
      .mockResolvedValueOnce(jsonResponse(invoiceResponse));

    const provider = buildHarness();
    const result = await provider.bookShipment({
      ...bookingRequest,
      providerRateId: 'GIGL_INTL_2_0_0_1',
      receiver: {
        ...bookingRequest.receiver,
        name: 'Jane Receiver',
        phone: '+14165550123',
        email: 'jane@example.com',
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
        postalCode: 'M5V 3L9',
      },
      items: [
        {
          ...bookingRequest.items[0],
          height: 6,
          hsCode: '851712',
          length: 10,
          width: 8,
        },
      ],
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${baseUrl}/login`,
      `${baseUrl}/country/get?CountryName=Canada`,
      `${baseUrl}/intlShipment/create`,
      `${baseUrl}/invoice/generate`,
    ]);
    const bookingPayload = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')
    );
    expect(bookingPayload.Shipments[0]).toMatchObject({
      Receiver: {
        ReceiverName: 'Jane Receiver',
        ReceiverPhoneNumber: '+14165550123',
        ReceiverAltPhoneNumber: '+14165550123',
        ReceiverEmail: 'jane@example.com',
        ReceiverCity: 'Toronto',
        ReceiverAddress: '123 Queen Street West',
        ReceiverState: 'Ontario',
        ReceiverPostalCode: 'M5V 3L9',
        ReceiverCountryCode: 'CA',
        ReceiverCountry: 'Canada',
        ReceiverStateOrProvinceCode: 'Ontario',
      },
      ShipmentDetails: {
        DestinationCountryId: 36,
        ManufacturerCountry: 'Nigeria',
        PickupOptions: 1,
        DeliveryType: 2,
        LogisticsCompany: 0,
        DeclaredValue: 100_000,
      },
    });
    expect(bookingPayload.Shipments[0].ShipmentDetails).not.toHaveProperty(
      'ShipmentMethod'
    );
    expect(bookingPayload.Shipments[0].ShipmentItems[0]).toMatchObject({
      InternationalShipmentItemType: 0,
      Quantity: 1,
      Weight: 1,
      Value: 100_000,
      HSCode: '851712',
      IsVolumetric: true,
      Length: 10,
      Width: 8,
      Height: 6,
    });
    expect(bookingPayload.Shipments[0].ShipmentPackages[0]).toMatchObject({
      Weight: 1,
      Length: 10,
      Width: 8,
      Height: 6,
    });
    const invoicePayload = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body ?? '{}')
    );
    expect(invoicePayload).toEqual({ Waybill: 'GIGL-INTL-1' });
    expect(result).toMatchObject({
      provider: 'GIGL',
      trackingNumber: 'GIGL-INTL-1',
      labelUrl: 'https://example.test/gigl-label.pdf',
      carrierName: 'GIG Logistics',
      isStationPickup: false,
      status: 'booked',
    });
  });

  it('only routes bookings with international GIGL rate IDs to the international API', () => {
    expect(
      isGiglInternationalBookingRequest({
        ...bookingRequest,
        providerRateId: 'GIGL_4_1',
        receiver: {
          ...bookingRequest.receiver,
          country: 'Canada',
          countryCode: 'CA',
        },
      })
    ).toBe(false);
    expect(
      isGiglInternationalBookingRequest({
        ...bookingRequest,
        providerRateId: 'GIGL_INTL_2_0_0_1',
      })
    ).toBe(true);
  });

  it('rejects outbound international bookings when GIGL omits tracking data', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { message: 'Success', status: 200, data: {} },
        })
      );

    const provider = buildHarness();

    await expect(
      provider.bookShipment({
        ...bookingRequest,
        providerRateId: 'GIGL_INTL_2_0_0_1',
        receiver: {
          ...bookingRequest.receiver,
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
      })
    ).rejects.toThrow(
      'GIGL international booking response missing tracking number'
    );
  });

  it('bugfix: a post-submit answer without tracking data is unconfirmed, not unexpected', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { message: 'Success', status: 200, data: {} },
        })
      );

    const error = await buildHarness()
      .bookShipment({
        ...bookingRequest,
        providerRateId: 'GIGL_INTL_2_0_0_1',
        receiver: {
          ...bookingRequest.receiver,
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
      })
      .catch((e: unknown) => e);

    expect(classifyBookingFailure(error).outcome).toBe('provider_unconfirmed');
  });

  it('keeps successful bookings when invoice label generation fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(loginResponseWithoutCustomerType))
      .mockResolvedValueOnce(jsonResponse(internationalCountriesResponse))
      .mockResolvedValueOnce(jsonResponse(internationalBookingResponse))
      .mockRejectedValueOnce(new Error('invoice timeout'));

    const provider = buildHarness();
    const result = await provider.bookShipment({
      ...bookingRequest,
      providerRateId: 'GIGL_INTL_2_0_0_1',
      receiver: {
        ...bookingRequest.receiver,
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
        postalCode: 'M5V 3L9',
      },
    });

    expect(result).toMatchObject({
      provider: 'GIGL',
      trackingNumber: 'GIGL-INTL-1',
      labelUrl: undefined,
    });
  });
});
