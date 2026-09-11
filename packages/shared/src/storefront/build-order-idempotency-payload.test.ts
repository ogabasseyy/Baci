import { describe, expect, it, vi } from 'vitest';
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

  it('orders hash-significant item fields independently of localeCompare', () => {
    const localeCompare = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockReturnValue(-1);

    try {
      const payload = buildOrderIdempotencyPayload({
        customer_email: 'buyer@example.com',
        customer_name: 'Ada Okafor',
        items: [
          { product_id: 'case', price: 5000, quantity: 1, variant_name: 'ö' },
          { product_id: 'case', price: 5000, quantity: 1, variant_name: 'z' },
        ],
        merchant_id: 'merchant-one',
      });

      expect(payload.items.map((item) => item.variant_name)).toEqual([
        'z',
        'ö',
      ]);
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
  });
});
