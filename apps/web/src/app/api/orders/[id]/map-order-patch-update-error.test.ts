import { describe, expect, it } from 'vitest';
import { mapOrderPatchUpdateError } from './map-order-patch-update-error';

describe('mapOrderPatchUpdateError', () => {
  it('maps active shipping charge address edit blocks to 409', async () => {
    const response = mapOrderPatchUpdateError({
      message: 'active_shipping_charge_address_edit_blocked',
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: 'active_shipping_charge_address_edit_blocked',
      error:
        'Shipping address cannot change while a wallet shipping charge is active.',
    });
  });

  it('maps active shipping charge quote replacement blocks to 409', async () => {
    const response = mapOrderPatchUpdateError({
      message: 'active_shipping_charge_quote_replacement_blocked',
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: 'active_shipping_charge_quote_replacement_blocked',
      error:
        'Shipping quote cannot change while a wallet shipping charge is active.',
    });
  });

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
    const response = mapOrderPatchUpdateError({ code: 'P0001', message });
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({ code });
  });

  it('returns null for unrelated update errors', () => {
    expect(
      mapOrderPatchUpdateError({ message: 'Failed to update order' })
    ).toBeNull();
  });
});
