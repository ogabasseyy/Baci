import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GIGL_BASE_URL =
    'https://dev-thirdpartynode.theagilitysystems.com';
});

import { bookGiglShipment } from './gigl.booking';
import { PickupOptions } from './gigl.constants';
import {
  bookingRequest,
  bookingResponse,
  jsonResponse,
  stationsResponse,
} from './gigl.test-helpers';

describe('GIGL booking station binding', () => {
  it('reuses the quoted sender station when address text no longer resolves', async () => {
    const [lagosStation, receiverStation] = stationsResponse.data.data;
    const safeFetchEnvelopeWithAccessToken = vi.fn().mockResolvedValue({
      envelope: bookingResponse.data,
      response: jsonResponse(bookingResponse),
    });
    const apiClient = {
      baseUrl: 'https://dev-thirdpartynode.theagilitysystems.com',
      currentToken: null,
      getApiToken: vi.fn().mockResolvedValue({
        token: 'token',
        userChannelCode: 'channel',
        userChannelType: 2,
        customerType: 2,
      }),
      parseEnvelopeData: vi.fn().mockReturnValue({ Waybill: 'GIGL-WB-1' }),
      safeFetchEnvelopeWithAccessToken,
    };
    const stationsService = {
      findServiceCentreById: vi.fn().mockResolvedValue(null),
      findStationById: vi
        .fn()
        .mockImplementation((stationId: number) =>
          Promise.resolve(
            stationId === lagosStation.StationId
              ? lagosStation
              : receiverStation
          )
        ),
      findStationForCity: vi.fn().mockResolvedValue(null),
    };

    await expect(
      bookGiglShipment(
        apiClient as never,
        stationsService as never,
        { safeFetch: vi.fn(), log: vi.fn() },
        {
          ...bookingRequest,
          providerRateId: `GIGL_${receiverStation.StationId}_${PickupOptions.HomeDelivery}_1_0_0_${lagosStation.StationId}`,
          sender: {
            ...bookingRequest.sender,
            city: 'Ikeja',
            state: '',
          },
        }
      )
    ).resolves.toMatchObject({ trackingNumber: 'GIGL-WB-1' });

    expect(stationsService.findStationById).toHaveBeenCalledWith(
      lagosStation.StationId,
      expect.any(Number),
      expect.any(AbortSignal)
    );
    expect(stationsService.findStationForCity).not.toHaveBeenCalledWith(
      'Ikeja',
      '',
      expect.any(Number),
      expect.any(AbortSignal)
    );
  });

  it('does not fall back to address text when the quoted sender station is missing', async () => {
    const [, receiverStation] = stationsResponse.data.data;
    const apiClient = {
      baseUrl: 'https://dev-thirdpartynode.theagilitysystems.com',
      currentToken: null,
      getApiToken: vi.fn().mockResolvedValue({
        token: 'token',
        userChannelCode: 'channel',
        userChannelType: 2,
        customerType: 2,
      }),
    };
    const stationsService = {
      findStationById: vi.fn().mockResolvedValue(null),
      findStationForCity: vi.fn().mockResolvedValue(receiverStation),
    };

    await expect(
      bookGiglShipment(
        apiClient as never,
        stationsService as never,
        { safeFetch: vi.fn(), log: vi.fn() },
        {
          ...bookingRequest,
          providerRateId: `GIGL_${receiverStation.StationId}_${PickupOptions.HomeDelivery}_1_0_0_999`,
        }
      )
    ).rejects.toMatchObject({
      code: 'GIGL_STATION_RESOLUTION_FAILED',
      message: 'Quoted GIGL sender station was not found',
    });

    expect(stationsService.findStationForCity).not.toHaveBeenCalled();
  });
});
