import { AIRPORT_DELIVERY_FEES } from '@baci/shared/constants';
import { getLegacyAirportType } from '@/lib/checkout/airport-delivery-legacy-marker';

type AirportType = 'delivery' | 'pickup';

type LegacyMobileAirportDeliveryInput = Readonly<{
  address?: string | null;
  airportType?: AirportType;
  deliveryMethod?: string;
  selectedQuoteId?: string | null;
  shippingFee: number;
  shippingRateId?: string | null;
  source?: string;
}>;

/**
 * Identifies the released mobile airport-delivery request shape that predates
 * delivery metadata. The legacy marker and source are required so a fee alone
 * can never classify an otherwise metadata-free order as airport delivery.
 */
export function isLegacyMobileAirportDeliveryRequest({
  address,
  airportType,
  deliveryMethod,
  selectedQuoteId,
  shippingFee,
  shippingRateId,
  source,
}: LegacyMobileAirportDeliveryInput): boolean {
  return (
    source === 'mobile_app' &&
    deliveryMethod === undefined &&
    airportType === undefined &&
    getLegacyAirportType(address) === 'delivery' &&
    !selectedQuoteId &&
    !shippingRateId &&
    Math.abs(shippingFee - AIRPORT_DELIVERY_FEES.legacy) <= 0.01
  );
}
