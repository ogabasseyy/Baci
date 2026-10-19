type AirportType = 'delivery' | 'pickup';

interface ResolveLegacyAirportDeliveryMetadataInput {
  deliveryMethod?: string;
  legacyAirportType: AirportType | null;
  selectedQuoteId?: string | null;
  shippingRateId?: string | null;
}

export function resolveLegacyAirportDeliveryMetadata({
  deliveryMethod,
  legacyAirportType,
  selectedQuoteId,
  shippingRateId,
}: ResolveLegacyAirportDeliveryMetadataInput): {
  resolvedDeliveryMethod: 'airport';
  resolvedAirportType: AirportType;
} | null {
  if (
    deliveryMethod !== undefined ||
    legacyAirportType === null ||
    selectedQuoteId ||
    shippingRateId
  ) {
    return null;
  }

  return {
    resolvedDeliveryMethod: 'airport',
    resolvedAirportType: legacyAirportType,
  };
}
