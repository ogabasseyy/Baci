import { describe, expect, it } from 'vitest';
import { mapPartnerDeliveryConflict } from './map-partner-delivery-conflict';

describe('mapPartnerDeliveryConflict', () => {
  it.each([
    [
      'partner_delivery_destination_changed',
      'PARTNER_DELIVERY_DESTINATION_CHANGED',
    ],
    [
      'partner_delivery_origin_or_parcel_changed',
      'PARTNER_DELIVERY_ORIGIN_OR_PARCEL_CHANGED',
    ],
    ['partner_order_source_immutable', 'PARTNER_ORDER_SOURCE_IMMUTABLE'],
    [
      'partner_shipping_requires_merchant_wallet',
      'PARTNER_SHIPPING_REQUIRES_MERCHANT_WALLET',
    ],
    ['partner_shipping_quote_invalid', 'PARTNER_SHIPPING_QUOTE_INVALID'],
    ['partner_delivery_price_changed', 'PARTNER_DELIVERY_PRICE_CHANGED'],
    ['partner_delivery_service_changed', 'PARTNER_DELIVERY_SERVICE_CHANGED'],
    [
      'partner_settled_order_amounts_immutable',
      'PARTNER_SETTLED_ORDER_AMOUNTS_IMMUTABLE',
    ],
  ])('maps %s to a stable 409', async (message, code) => {
    for (const input of [message, `ERROR: ${message}`]) {
      const response = mapPartnerDeliveryConflict(input);
      expect(response?.status).toBe(409);
      await expect(response?.json()).resolves.toMatchObject({ code });
    }
  });

  it.each([
    undefined,
    '',
    'unknown',
    'constructor',
    'ERROR: unrelated partner_delivery_price_changed error',
  ])('leaves unknown error %s to its caller', (message) => {
    expect(mapPartnerDeliveryConflict(message)).toBeNull();
  });
});
