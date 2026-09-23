import { priceGiglQuote } from '../gigl-platform-pricing';
import type { QuoteRequest, ShippingQuote } from '../types';
import type { GiglApiClient } from './gigl.auth';
import {
  buildGiglProviderRateId,
  GIGL_DEFAULT_SPECIAL_PACKAGE_ID,
  GIGL_QUOTE_TIMEOUT_MS,
  GiglDeliveryType,
  type GiglQuoteIo,
  type GiglToken,
  getVehicleTypeForWeight,
  isGiglAbortError,
  PickupOptions,
  ShipmentType,
} from './gigl.constants';
import type { GiglStation } from './gigl.schemas';
import { giglSchemas } from './gigl.schemas';

export async function fetchGiglQuote(
  apiClient: GiglApiClient,
  io: GiglQuoteIo,
  tokenData: GiglToken,
  request: QuoteRequest,
  senderStation: GiglStation,
  receiverStation: GiglStation,
  pickupOption: PickupOptions,
  deliveryType: GiglDeliveryType,
  totalWeight: number,
  signal: AbortSignal
): Promise<ShippingQuote | null> {
  try {
    const activeTokenData = apiClient.currentToken ?? tokenData;
    const { envelope, response } =
      await apiClient.safeFetchEnvelopeWithAccessToken(
        `${apiClient.baseUrl}/price/v3`,
        activeTokenData,
        () => ({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            SenderStationId: senderStation.StationId,
            ReceiverStationId: receiverStation.StationId,
            SenderLocation: {
              Latitude:
                request.sender?.latitude ?? senderStation.Latitude ?? 6.5244,
              Longitude:
                request.sender?.longitude ?? senderStation.Longitude ?? 3.3792,
            },
            ReceiverLocation: {
              Latitude:
                request.receiver.latitude ?? receiverStation.Latitude ?? 6.5244,
              Longitude:
                request.receiver.longitude ??
                receiverStation.Longitude ??
                3.3792,
            },
            VehicleType: getVehicleTypeForWeight(totalWeight),
            PickUpOptions: pickupOption,
            IsPriorityShipment: deliveryType === GiglDeliveryType.GoFaster,
            ShipmentItems: request.items.map((item) => ({
              ItemName: item.name,
              Description: item.description || item.name,
              Quantity: item.quantity,
              Weight: item.weight,
              Value: item.value,
              IsVolumetric: false,
              ShipmentType: ShipmentType.Regular,
              SpecialPackageId: GIGL_DEFAULT_SPECIAL_PACKAGE_ID,
            })),
          }),
          timeout: GIGL_QUOTE_TIMEOUT_MS,
          signal,
        })
      );
    if (!response.ok) {
      const error = await response.text();
      io.log('warn', 'GIGL quote request failed', {
        status: response.status,
        error,
      });
      return null;
    }
    if (envelope?.status !== 200) {
      return null;
    }
    const priceData = apiClient.parseEnvelopeData(
      envelope,
      giglSchemas.priceData,
      'price'
    );
    const pricing = priceGiglQuote(priceData.GrandTotal);
    const isStationPickup = pickupOption === PickupOptions.ServiceCentre;
    const serviceName =
      deliveryType === GiglDeliveryType.GoFaster ? 'GoFaster' : 'GoStandard';
    const stationPickupDisplayName = receiverStation.Address
      ? `GIG Logistics - Pickup at ${receiverStation.StationName} (${receiverStation.Address})`
      : `GIG Logistics - Pickup at ${receiverStation.StationName}`;
    return {
      id: io.generateQuoteId(),
      provider: 'GIGL',
      serviceTier: isStationPickup
        ? `Station Pickup - ${serviceName}`
        : serviceName,
      carrierName: 'GIG Logistics',
      displayName: isStationPickup
        ? `${stationPickupDisplayName} - ${serviceName}`
        : `GIG Logistics - ${serviceName}`,
      estimatedDays: 2,
      deliveryRange: '1-3 working days',
      minDays: 1,
      maxDays: 3,
      price: pricing.price,
      providerCost: pricing.providerCost,
      platformMargin: pricing.platformMargin,
      marginBasisPoints: pricing.marginBasisPoints,
      pricingVersion: pricing.pricingVersion,
      currency: 'NGN',
      pickupIncluded: true,
      insuranceIncluded: true,
      providerRateId: buildGiglProviderRateId({
        senderStationId: senderStation.StationId,
        receiverStationId: receiverStation.StationId,
        pickupOption,
        vehicleType: getVehicleTypeForWeight(totalWeight),
        deliveryType,
      }),
      expiresAt: io.getQuoteExpiry(1),
      stationId: isStationPickup ? receiverStation.StationId : undefined,
      stationName: isStationPickup ? receiverStation.StationName : undefined,
      stationAddress: isStationPickup ? receiverStation.Address : undefined,
      stationCode: isStationPickup ? receiverStation.StationCode : undefined,
      isStationPickup,
      // Keep pickupStation* aliases for existing app/API consumers while station* fields back DB persistence.
      pickupStationId: isStationPickup ? receiverStation.StationId : undefined,
      pickupStationName: isStationPickup
        ? receiverStation.StationName
        : undefined,
      pickupStationAddress: isStationPickup
        ? receiverStation.Address
        : undefined,
      pickupStationCode: isStationPickup
        ? receiverStation.StationCode
        : undefined,
      rawResponse: priceData,
    };
  } catch (error) {
    if (signal.aborted || isGiglAbortError(error)) {
      throw error;
    }
    io.log('error', 'Error fetching GIGL quote', { error: String(error) });
    return null;
  }
}
