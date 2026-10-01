import { describe, expect, it } from 'vitest';
import { isLegacyMobileAirportDeliveryRequest } from './is-legacy-mobile-airport-delivery';

describe('isLegacyMobileAirportDeliveryRequest', () => {
  it('recognizes the released mobile legacy airport-delivery shape', () => {
    const request = {
      address: 'Airport Delivery (Outside Lagos)',
      shippingFee: 25_000,
      source: 'mobile_app',
    };

    const result = isLegacyMobileAirportDeliveryRequest(request);

    expect(result).toBe(true);
  });

  it('does not classify the same fee from a non-mobile source', () => {
    const request = {
      address: 'Airport Delivery',
      shippingFee: 25_000,
      source: 'online_store',
    };

    const result = isLegacyMobileAirportDeliveryRequest(request);

    expect(result).toBe(false);
  });

  it('does not classify a mobile order when delivery metadata is present', () => {
    const request = {
      address: 'Airport Delivery',
      deliveryMethod: 'door',
      shippingFee: 25_000,
      source: 'mobile_app',
    };

    const result = isLegacyMobileAirportDeliveryRequest(request);

    expect(result).toBe(false);
  });
});
