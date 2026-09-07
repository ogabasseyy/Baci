import { describe, expect, it } from 'vitest';
import {
  ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT,
  getAdminOrderGiglQuoteOrderConflict,
} from './admin-order-gigl-quote-order';

describe('ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT', () => {
  it('projects the shipping and item fields needed for admin GIGL quotes', () => {
    expect(ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT).toContain('shipping_status');
    expect(ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT).toContain('shipment_id');
    expect(ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT).toContain('order_items(');
    expect(ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT).not.toContain('*');
  });
});

describe('getAdminOrderGiglQuoteOrderConflict', () => {
  it('returns null for a processing order that is not yet booked', () => {
    expect(
      getAdminOrderGiglQuoteOrderConflict({
        shipping_status: 'processing',
        shipment_id: null,
        tracking_number: null,
      })
    ).toBeNull();
  });

  it('returns 409 when the order already has a shipment id', async () => {
    const response = getAdminOrderGiglQuoteOrderConflict({
      shipping_status: 'processing',
      shipment_id: 'ship-1',
      tracking_number: null,
    });

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'Order already shipped or booked',
    });
  });

  it('returns 409 when the order already has a tracking number', async () => {
    const response = getAdminOrderGiglQuoteOrderConflict({
      shipping_status: 'processing',
      shipment_id: null,
      tracking_number: 'TRK-1',
    });

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'Order already shipped or booked',
    });
  });

  it.each([
    'shipped',
    'booked',
    'in_transit',
    'SHIPPED',
  ])('returns 409 when shipping_status is %s', async (shipping_status) => {
    const response = getAdminOrderGiglQuoteOrderConflict({
      shipping_status,
      shipment_id: null,
      tracking_number: null,
    });

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'Order already shipped or booked',
    });
  });

  it('returns 409 when the order is not processing', async () => {
    const response = getAdminOrderGiglQuoteOrderConflict({
      shipping_status: 'pending',
      shipment_id: null,
      tracking_number: null,
    });

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'Order must be processing before shipping',
    });
  });
});
