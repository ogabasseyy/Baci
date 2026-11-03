import { describe, expect, it } from 'vitest';
import {
  orderShippingAddressSaveErrorSchema,
  orderShippingAddressSaveResponseSchema,
} from './order-shipping-address-save';

describe('order shipping address save schemas', () => {
  it('accepts an order edit response with an order id', () => {
    expect(
      orderShippingAddressSaveResponseSchema.safeParse({
        order: { id: 'order-1', shipping_status: 'processing' },
      }).success
    ).toBe(true);
  });

  it.each([
    [{}],
    [{ order: {} }],
    [{ order: { id: '' } }],
    [null],
  ])('rejects a response without an order id: %j', (body) => {
    expect(orderShippingAddressSaveResponseSchema.safeParse(body).success).toBe(
      false
    );
  });

  it('reads the safe error shape and tolerates a missing code', () => {
    expect(
      orderShippingAddressSaveErrorSchema.parse({ error: 'Order not found' })
    ).toEqual({ error: 'Order not found' });
    expect(
      orderShippingAddressSaveErrorSchema.safeParse({ error: 42 }).success
    ).toBe(false);
  });
});
