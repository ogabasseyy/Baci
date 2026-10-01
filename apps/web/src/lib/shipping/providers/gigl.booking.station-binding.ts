import { OrderShipmentBookingError } from '../order-shipment-booking-utils';
import type { BookingRequest } from '../types';
import {
  GIGL_BOOKING_TIMEOUT_MS,
  type parseGiglProviderRateId,
} from './gigl.constants';
import type { GiglStation } from './gigl.schemas';
import type { GiglStationsService } from './gigl.stations';

type GiglSelectedRate = ReturnType<typeof parseGiglProviderRateId>;

export async function resolveGiglBookingSenderStation(
  stationsService: GiglStationsService,
  selectedRate: GiglSelectedRate,
  sender: BookingRequest['sender'],
  signal: AbortSignal
): Promise<GiglStation> {
  const senderStation =
    selectedRate.senderStationId !== undefined
      ? await stationsService.findStationById(
          selectedRate.senderStationId,
          GIGL_BOOKING_TIMEOUT_MS,
          signal
        )
      : await stationsService.findStationForCity(
          sender.city,
          sender.state,
          GIGL_BOOKING_TIMEOUT_MS,
          signal
        );

  if (senderStation) {
    return senderStation;
  }

  throw new OrderShipmentBookingError(
    selectedRate.senderStationId === undefined
      ? 'No GIGL station found for pickup location'
      : 'Quoted GIGL sender station was not found',
    400,
    'GIGL_STATION_RESOLUTION_FAILED'
  );
}
