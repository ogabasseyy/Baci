import { describe, expect, it } from 'vitest';
import { buildOrderIdempotencyPayload } from './build-order-idempotency-payload';

describe('buildOrderIdempotencyPayload', () => {
  it('normalizes email casing and delivery whitespace', () => {
    const base = {
      customer_email: 'Buyer@Example.com',
      customer_name: 'Ada Okafor',
      customer_phone: '08012345678',
      items: [{ product_id: 'buds2', price: 85000, quantity: 1 }],
      merchant_id: 'merchant-one',
      shipping_address: {
        address: '15  Marina   Road',
        city: 'Lagos',
        state: 'Lagos',
      },
      shipping_fee: 7692,
    };

    expect(buildOrderIdempotencyPayload(base)).toEqual(
      buildOrderIdempotencyPayload({
        ...base,
        customer_email: 'buyer@example.com',
        shipping_address: {
          address: '15 Marina Road',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    );
  });

  it('orders hash-significant item fields by Unicode scalar values', () => {
    const payload = buildOrderIdempotencyPayload({
      customer_email: 'buyer@example.com',
      customer_name: 'Ada Okafor',
      items: [
        {
          product_id: 'case',
          price: 5000,
          quantity: 1,
          variant_name: '\u{10000}',
        },
        {
          product_id: 'case',
          price: 5000,
          quantity: 1,
          variant_name: '\u{E000}',
        },
      ],
      merchant_id: 'merchant-one',
    });

    expect(payload.items.map((item) => item.variant_name)).toEqual([
      '\u{e000}',
      '\u{10000}',
    ]);
  });
});
