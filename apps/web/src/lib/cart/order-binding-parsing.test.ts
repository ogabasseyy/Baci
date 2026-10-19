import { describe, expect, it } from 'vitest';
import {
  parseBoundOrder,
  parseOrderBindingReceipt,
} from './order-binding-parsing';

const orderRow = {
  customer_email: 'buyer@example.com',
  customer_id: 'customer-1',
  customer_name: 'Ada',
  customer_phone: null,
  discount_amount: 0,
  gift_wrapping_fee: 0,
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: 'ORD-1',
  payment_method: 'card',
  payment_status: 'paid',
  shipping_address: { city: 'Lagos' },
  shipping_fee: 500,
  shipping_status: 'pending',
  subtotal: 10000,
  tax_amount: 0,
  tax_basis: 'subtotal',
  total: 10500,
};

describe('parseBoundOrder', () => {
  it('parses a complete inner-RPC order row', () => {
    const parsed = parseBoundOrder(orderRow);
    expect(parsed?.id).toBe('order-1');
    expect(parsed?.total).toBe(10500);
    expect(parsed?.idempotency_replayed).toBe(false);
    expect(parsed?.tracking_token).toBeNull();
  });

  it('carries savings receipt columns only when present', () => {
    const parsed = parseBoundOrder({
      ...orderRow,
      savings_goal_id: 'goal-1',
      savings_redemption_success: true,
    });
    expect(parsed?.savings_goal_id).toBe('goal-1');
    expect(parsed?.savings_redemption_success).toBe(true);
    expect(parsed?.savings_redemption_id).toBeUndefined();
  });

  it('rejects rows missing required fields', () => {
    expect(parseBoundOrder(null)).toBeNull();
    expect(parseBoundOrder({ ...orderRow, id: '' })).toBeNull();
    expect(parseBoundOrder({ ...orderRow, total: '10500' })).toBeNull();
  });
});

describe('parseOrderBindingReceipt', () => {
  it('parses a binding receipt', () => {
    expect(
      parseOrderBindingReceipt({
        cartId: 'cart-1',
        cartVersionReviewed: 3,
        checkout_generation: 2,
        merchantId: 'merchant-1',
        sessionId: 'session-1',
        variant: 'savings',
      })
    ).toEqual({
      cartId: 'cart-1',
      cartVersionReviewed: 3,
      checkoutGeneration: 2,
      merchantId: 'merchant-1',
      sessionId: 'session-1',
      variant: 'savings',
    });
  });

  it('rejects unknown variants and non-integer generations', () => {
    expect(
      parseOrderBindingReceipt({
        cartId: 'cart-1',
        cartVersionReviewed: 3,
        checkout_generation: 2,
        merchantId: 'merchant-1',
        sessionId: 'session-1',
        variant: 'mystery',
      })
    ).toBeNull();
    expect(
      parseOrderBindingReceipt({
        cartId: 'cart-1',
        cartVersionReviewed: 3,
        checkout_generation: 2.5,
        merchantId: 'merchant-1',
        sessionId: 'session-1',
        variant: 'base',
      })
    ).toBeNull();
  });
});
