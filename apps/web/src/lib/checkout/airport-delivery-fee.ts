import { AIRPORT_DELIVERY_FEES } from '@baci/shared/constants';
import { getLegacyAirportType } from '@/lib/checkout/airport-delivery-legacy-marker';

type AirportType = Exclude<keyof typeof AIRPORT_DELIVERY_FEES, 'legacy'>;

interface LocalAirportDeliveryFeeInput {
  airportType?: AirportType;
  deliveryMethod?: string;
  selectedQuoteId?: string | null;
  shippingAddress?: { address?: string | null } | null;
  shippingRateId?: string | null;
}

/**
 * Resolve the server-owned fee for a local airport order.
 *
 * Provider-backed airport quotes and merchant-configured rates have their own
 * server verification paths, so this returns null for either selected id.
 * The exact legacy address markers preserve protection for older clients that
 * did not yet send delivery metadata. A fee amount alone is intentionally not
 * treated as an airport signal because the same amount can be a valid
 * merchant-configured door-delivery rate.
 */
export function getLocalAirportDeliveryFee({
  airportType,
  deliveryMethod,
  selectedQuoteId,
  shippingAddress,
  shippingRateId,
}: LocalAirportDeliveryFeeInput): number | null {
  if (selectedQuoteId || shippingRateId) return null;

  if (deliveryMethod !== undefined && deliveryMethod !== 'airport') return null;

  const legacyAirportType = getLegacyAirportType(shippingAddress?.address);
  if (deliveryMethod === undefined && legacyAirportType === null) return null;

  const resolvedAirportType =
    deliveryMethod === 'airport'
      ? (airportType ?? 'delivery')
      : legacyAirportType;
  if (resolvedAirportType === null) return null;
  return AIRPORT_DELIVERY_FEES[resolvedAirportType];
}
