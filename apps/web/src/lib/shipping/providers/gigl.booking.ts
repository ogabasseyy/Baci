import { OrderShipmentBookingError } from '../order-shipment-booking-utils';
import type { BookingRequest, ShipmentBookingResult } from '../types';
import type { GiglApiClient } from './gigl.auth';
import { resolveGiglBookingSenderStation } from './gigl.booking.station-binding';
import {
  GIGL_BOOKING_TIMEOUT_MS,
  GIGL_DEFAULT_SPECIAL_PACKAGE_ID,
  GIGL_PRICING_STRATEGY,
  GiglDeliveryType,
  type GiglProviderIo,
  getVehicleTypeForWeight,
  isGiglAbortError,
  PickupOptions,
  parseGiglProviderRateId,
  ShipmentType,
} from './gigl.constants';
import {
  bookGiglInternationalShipment,
  isGiglInternationalBookingRequest,
} from './gigl.international.booking';
import { giglSchemas } from './gigl.schemas';
import type { GiglStationsService } from './gigl.stations';

function stationResolutionError(message: string) {
  return new OrderShipmentBookingError(
    message,
    400,
    'GIGL_STATION_RESOLUTION_FAILED'
  );
}

export async function bookGiglShipment(
  apiClient: GiglApiClient,
  stationsService: GiglStationsService,
  io: GiglProviderIo,
  request: BookingRequest
): Promise<ShipmentBookingResult> {
  if (isGiglInternationalBookingRequest(request)) {
    return bookGiglInternationalShipment(apiClient, io, request);
  }

  const signal = AbortSignal.timeout(GIGL_BOOKING_TIMEOUT_MS);
  const selectedRate = parseGiglProviderRateId(request.providerRateId);
  const isStationPickup =
    selectedRate.pickupOption === PickupOptions.ServiceCentre;
  const totalWeight = request.items.reduce(
    (sum, item) => sum + item.weight * item.quantity,
    0
  );
  const vehicleType =
    selectedRate.vehicleType ?? getVehicleTypeForWeight(totalWeight);

  try {
    let tokenData: Awaited<ReturnType<GiglApiClient['getApiToken']>>;
    try {
      tokenData = await apiClient.getApiToken(GIGL_BOOKING_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof OrderShipmentBookingError) {
        throw error;
      }
      if (signal.aborted || isGiglAbortError(error)) {
        throw new OrderShipmentBookingError(
          'GIGL API authentication timed out',
          504,
          'GIGL_AUTHENTICATION_FAILED'
        );
      }
      throw new OrderShipmentBookingError(
        error instanceof Error
          ? error.message
          : 'GIGL API authentication failed',
        502,
        'GIGL_AUTHENTICATION_FAILED'
      );
    }
    const senderStation = await resolveGiglBookingSenderStation(
      stationsService,
      selectedRate,
      request.sender,
      signal
    );

    if (isStationPickup && selectedRate.receiverStationId === undefined) {
      throw stationResolutionError('Invalid GIGL station pickup rate');
    }

    const selectedReceiverStation =
      selectedRate.receiverStationId !== undefined
        ? await stationsService.findStationById(
            selectedRate.receiverStationId,
            GIGL_BOOKING_TIMEOUT_MS,
            signal
          )
        : null;

    if (
      selectedRate.receiverStationId !== undefined &&
      !selectedReceiverStation
    ) {
      throw stationResolutionError('Selected GIGL station was not found');
    }

    const receiverStation =
      selectedReceiverStation ||
      (await stationsService.findStationForCity(
        request.receiver.city,
        request.receiver.state,
        GIGL_BOOKING_TIMEOUT_MS,
        signal
      ));

    if (!receiverStation) {
      throw stationResolutionError(
        'No GIGL station found for delivery location'
      );
    }

    const selectedServiceCentre =
      isStationPickup && selectedRate.serviceCentreId !== undefined
        ? await stationsService.findServiceCentreById(
            receiverStation.StationId,
            selectedRate.serviceCentreId,
            GIGL_BOOKING_TIMEOUT_MS,
            signal
          )
        : null;
    if (
      isStationPickup &&
      selectedRate.serviceCentreId !== undefined &&
      !selectedServiceCentre
    ) {
      throw stationResolutionError(
        'Selected GIGL service centre was not found'
      );
    }

    const bookingTokenData = apiClient.currentToken ?? tokenData;
    const { envelope, response } =
      await apiClient.safeFetchEnvelopeWithAccessToken(
        `${apiClient.baseUrl}/capture/preshipment`,
        bookingTokenData,
        () => ({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            SenderDetails: {
              SenderLocation: {
                Latitude:
                  request.sender.latitude ?? senderStation.Latitude ?? 6.5244,
                Longitude:
                  request.sender.longitude ?? senderStation.Longitude ?? 3.3792,
              },
              SenderName: request.sender.name,
              SenderPhoneNumber: request.sender.phone,
              SenderStationId: senderStation.StationId,
              SenderAddress: request.sender.address,
              InputtedSenderAddress: request.sender.address,
              SenderLocality: request.sender.state,
            },
            ReceiverDetails: {
              ReceiverLocation: {
                Latitude:
                  selectedServiceCentre?.Latitude ??
                  request.receiver.latitude ??
                  receiverStation.Latitude ??
                  6.5244,
                Longitude:
                  selectedServiceCentre?.Longitude ??
                  request.receiver.longitude ??
                  receiverStation.Longitude ??
                  3.3792,
              },
              ReceiverStationId: receiverStation.StationId,
              ...(selectedServiceCentre
                ? {
                    DestinationServiceCenterId:
                      selectedServiceCentre.ServiceCentreId,
                  }
                : {}),
              ReceiverName: request.receiver.name,
              ReceiverPhoneNumber: request.receiver.phone,
              ReceiverAddress:
                selectedServiceCentre?.Address ?? request.receiver.address,
              InputtedReceiverAddress:
                selectedServiceCentre?.Address ?? request.receiver.address,
            },
            ShipmentDetails: {
              VehicleType: vehicleType,
              IsPriorityShipment:
                selectedRate.deliveryType === GiglDeliveryType.GoFaster,
              IsCashOnDelivery: false,
              CashOnDeliveryAmount: 0,
              PricingStrategy: GIGL_PRICING_STRATEGY,
              IsFromAgility: 0,
              IsBatchPickUp: 0,
            },
            ShipmentItems: request.items.map((item) => ({
              ItemName: item.name,
              Description: item.description || item.name,
              Quantity: item.quantity,
              Value: item.value,
              ShipmentType: ShipmentType.Regular,
              Weight: item.weight,
              IsVolumetric: false,
              SpecialPackageId: GIGL_DEFAULT_SPECIAL_PACKAGE_ID,
            })),
          }),
          timeout: GIGL_BOOKING_TIMEOUT_MS,
          signal,
        })
      );

    if (!response.ok) {
      const error = await response.text();
      io.log('error', 'GIGL booking failed', {
        status: response.status,
        error,
      });
      if (response.status === 400) {
        throw new OrderShipmentBookingError(
          'GIGL rejected the shipment booking request. Please correct the order details and try again.',
          400,
          'GIGL_BOOKING_VALIDATION_FAILED'
        );
      }

      throw new Error('Failed to book GIGL shipment');
    }

    if (envelope?.status !== 200) {
      throw new Error('Invalid GIGL booking response');
    }

    const bookingData = apiClient.parseEnvelopeData(
      envelope,
      giglSchemas.bookingData,
      'booking'
    );
    const waybill = bookingData.Waybill;

    return {
      provider: 'GIGL',
      providerShipmentId: waybill,
      trackingNumber: waybill,
      carrierName: 'GIG Logistics',
      status: 'booked',
      isStationPickup,
      pickupStationName: isStationPickup
        ? (selectedServiceCentre?.ServiceCentreName ??
          receiverStation.StationName)
        : undefined,
      pickupStationAddress: isStationPickup
        ? (selectedServiceCentre?.Address ?? receiverStation.Address)
        : undefined,
      rawResponse: bookingData,
    };
  } catch (error) {
    if (error instanceof OrderShipmentBookingError) {
      throw error;
    }
    if (signal.aborted || isGiglAbortError(error)) {
      io.log('warn', 'GIGL booking timed out', {
        timeoutMs: GIGL_BOOKING_TIMEOUT_MS,
      });
      throw new Error('GIGL booking timed out');
    }

    throw error;
  }
}
