import { describe, expect, it } from 'vitest';
import {
  merchantOrderCancellationSchema,
  orderIdParamsSchema,
  orderUpdateSchema,
  reuseCheckoutOrderSchema,
} from './order-operations';

const id = '123e4567-e89b-12d3-a456-426614174000';

describe('order operation schemas', () => {
  it('preserves strict patch validation after extraction', () => {
    expect(orderUpdateSchema.parse({ shipping_status: 'shipped' })).toEqual({
      shipping_status: 'shipped',
    });
    expect(orderUpdateSchema.safeParse({ admin: true }).success).toBe(false);
  });

  it('preserves reuse quote clearing', () => {
    expect(
      reuseCheckoutOrderSchema.parse({
        order_id: id,
        merchant_id: id,
        tracking_token: 'token',
        customer_email: 'test@example.com',
        payment_method: 'card',
        selected_quote_id: null,
      }).selected_quote_id
    ).toBeNull();
  });

  it('validates order IDs and explicit cancellation confirmation', () => {
    expect(orderIdParamsSchema.parse({ id })).toEqual({ id });
    expect(merchantOrderCancellationSchema.safeParse({}).success).toBe(false);
    expect(
      merchantOrderCancellationSchema.parse({ confirm_cancellation: true })
    ).toEqual({ confirm_cancellation: true });
  });
});
