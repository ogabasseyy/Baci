import type { AirportQuoteRecord } from '@/lib/checkout/read-airport-delivery-quote';
import {
  GiglDeliveryType,
  PickupOptions,
  parseGiglProviderRateId,
} from '@/lib/shipping/providers/gigl.constants';

export function isEligibleAirportQuote(
  quote: AirportQuoteRecord,
  shippingProvider: string | null | undefined
): boolean {
  const provider =
    typeof quote.provider === 'string'
      ? quote.provider.trim().toUpperCase()
      : '';
  const providerRateId =
    typeof quote.provider_rate_id === 'string'
      ? quote.provider_rate_id.trim()
      : '';
  const serviceTier =
    typeof quote.service_tier === 'string'
      ? quote.service_tier.trim().toLowerCase()
      : null;
  const rateParts = providerRateId.split('_');
  const parsedRate = parseGiglProviderRateId(providerRateId);
  const normalizedShippingProvider = shippingProvider?.trim().toUpperCase();

  return (
    provider === 'GIGL' &&
    rateParts[0] === 'GIGL' &&
    rateParts[1] !== 'INTL' &&
    rateParts[2] === '0' &&
    rateParts[5] === '1' &&
    parsedRate.pickupOption === PickupOptions.HomeDelivery &&
    parsedRate.deliveryType === GiglDeliveryType.GoFaster &&
    (serviceTier === null || serviceTier.includes('gofaster')) &&
    normalizedShippingProvider === provider
  );
}
