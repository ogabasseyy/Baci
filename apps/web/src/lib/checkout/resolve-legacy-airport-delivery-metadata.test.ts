import { describe, expect, it } from 'vitest';
import { resolveLegacyAirportDeliveryMetadata } from '@/lib/checkout/resolve-legacy-airport-delivery-metadata';

describe('resolveLegacyAirportDeliveryMetadata', () => {
  it('returns canonical metadata for a fixed legacy airport marker', () => {
    const request = {
      deliveryMethod: undefined,
      legacyAirportType: 'pickup' as const,
      selectedQuoteId: undefined,
      shippingRateId: undefined,
    };

    const result = resolveLegacyAirportDeliveryMetadata(request);

    expect(result).toEqual({
      resolvedDeliveryMethod: 'airport',
      resolvedAirportType: 'pickup',
    });
  });

  it('does not infer metadata when a quote or rate is selected', () => {
    const request = {
      deliveryMethod: undefined,
      legacyAirportType: 'delivery' as const,
      selectedQuoteId: 'quote-id',
      shippingRateId: undefined,
    };

    const result = resolveLegacyAirportDeliveryMetadata(request);

    expect(result).toBeNull();
  });
});
