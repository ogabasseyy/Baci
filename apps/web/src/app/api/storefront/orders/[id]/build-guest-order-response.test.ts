import { describe, expect, it } from 'vitest';
import { buildGuestOrderResponse } from './build-guest-order-response';

describe('buildGuestOrderResponse', () => {
  it('projects the tracking row with proof and delivery bits', () => {
    const response = buildGuestOrderResponse({
      order: {
        id: 'order-1',
        order_number: 'ORD-1',
        currency: 'USD',
        subtotal: 240000,
        tax_amount: 5000,
        discount_amount: 0,
        gift_wrapping_fee: 0,
        shipping_cost: 10000,
        total: 255000,
        amount_paid: 255000,
        customer_name: 'Ada',
        customer_email: 'ada@example.com',
        customer_phone: '0801',
        shipping_address: 'Lagos',
        payment_status: 'bnpl_approved',
        shipping_status: 'pending',
        payment_method: 'credit_direct',
        external_source: null,
        import_job_id: null,
        merchant_id: 'merchant-1',
        notification_delivered: true,
      },
      token: 'tok-1',
      items: [{ id: 'item-1' }],
      virtualAccount: { account_number: '123' },
      inventoryConfirmed: true,
    });

    expect(response).toMatchObject({
      id: 'order-1',
      short_id: 'ORD-1',
      tracking_token: 'tok-1',
      notification_delivered: true,
      inventory_confirmed: true,
      shipping_cost: 10000,
    });
  });

  it('defaults absent money, reference, and proof fields', () => {
    const response = buildGuestOrderResponse({
      order: {
        id: 'order-1',
        order_number: 'ORD-1',
        currency: 'NGN',
        subtotal: 5000,
        total: 5000,
      },
      token: null,
      items: [],
      virtualAccount: null,
      inventoryConfirmed: false,
    });

    expect(response).toMatchObject({
      tax_amount: 0,
      discount_amount: 0,
      gift_wrapping_fee: 0,
      shipping_cost: 0,
      external_source: null,
      import_job_id: null,
      tracking_token: null,
      notification_delivered: false,
      inventory_confirmed: false,
    });
  });

  it('falls back to the legacy shipping fee for shipping cost', () => {
    const response = buildGuestOrderResponse({
      order: {
        id: 'order-1',
        order_number: 'ORD-1',
        currency: 'NGN',
        subtotal: 5000,
        shipping_fee: 1500,
        total: 6500,
      },
      token: null,
      items: [],
      virtualAccount: null,
      inventoryConfirmed: false,
    });

    expect(response.shipping_cost).toBe(1500);
  });
});
