import { describe, expect, it } from 'vitest';
import { shippingRecoveryContextSchema } from './shipping-checkout-recovery-context';

describe('checkout recovery context', () => {
  it('requires a surviving fulfillment quantity on context items', () => {
    const item = {
      name: 'Phone',
      quantity: 2,
      fulfillment_quantity: 1,
      price: 1000,
      product_id: null,
      product: {
        weight_value: 1,
        weight_unit: 'kg',
        dimensions: null,
        commodity_code: null,
      },
    };
    const order = {
      id: '40000000-0000-4000-8000-000000000001',
      merchant_id: '10000000-0000-4000-8000-000000000001',
      customer_name: null,
      customer_email: null,
      customer_phone: null,
      shipping_address: {},
      shipping_fee: 110,
      order_items: [item],
    };
    const context = {
      fingerprint: 'a'.repeat(64),
      order,
      quote_preference: null,
    };
    expect(shippingRecoveryContextSchema.parse(context)).toEqual(context);
    expect(
      shippingRecoveryContextSchema.safeParse({
        ...context,
        order: {
          ...order,
          order_items: [{ ...item, fulfillment_quantity: undefined }],
        },
      }).success
    ).toBe(false);
  });
});
