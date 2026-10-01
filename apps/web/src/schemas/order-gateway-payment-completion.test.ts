import { describe, expect, it } from 'vitest';
import { orderGatewayPaymentCompletionSchema } from '@/schemas/order-gateway-payment-completion';

describe('orderGatewayPaymentCompletionSchema', () => {
  it('accepts a locked merchant invoice balance-change conflict', () => {
    expect(
      orderGatewayPaymentCompletionSchema.safeParse({
        error_code: 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
        transaction_status: 'pending',
      }).success
    ).toBe(true);
  });

  it('parses a successful fresh completion payload', () => {
    const result = orderGatewayPaymentCompletionSchema.safeParse({
      actor: 'webhook:BAC-REF',
      already_completed: false,
      cancelled_at: null,
      order_already_paid: false,
      order_cancelled: false,
      order_number: 'ORD-260711-00NT-5',
      order_skipped_status: null,
      order_updated: true,
      payment_status: 'paid',
      previous_payment_status: 'pending',
      previous_shipping_status: 'pending',
      shipping_status: 'processing',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.order_updated).toBe(true);
      expect(result.data.error_code).toBeUndefined();
    }
  });

  it('parses a heal payload where only the order flip was outstanding', () => {
    const result = orderGatewayPaymentCompletionSchema.safeParse({
      already_completed: true,
      order_already_paid: false,
      order_cancelled: false,
      order_updated: true,
      payment_status: 'paid',
      previous_payment_status: 'pending',
      actor: 'cron:reconcile-gateway-paid-orders',
      cancelled_at: null,
      order_number: 'ORD-1',
      order_skipped_status: null,
      previous_shipping_status: 'pending',
      shipping_status: 'processing',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.already_completed).toBe(true);
      expect(result.data.order_updated).toBe(true);
    }
  });

  it('parses an idempotent strict merchant-invoice partial replay', () => {
    const result = orderGatewayPaymentCompletionSchema.safeParse({
      actor: 'verify:BAC-REF',
      already_completed: true,
      cancelled_at: null,
      merchant_invoice_partial_recorded: true,
      order_already_paid: false,
      order_cancelled: false,
      order_number: 'ORD-PARTIAL',
      order_skipped_status: null,
      order_updated: false,
      payment_status: 'partially_paid',
      previous_payment_status: 'partially_paid',
      previous_shipping_status: 'pending',
      shipping_status: 'pending',
      transaction_status: 'completed',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merchant_invoice_partial_recorded).toBe(true);
    }
  });

  it('parses every documented error code', () => {
    for (const code of [
      'INVALID_ARGUMENTS',
      'TRANSACTION_NOT_FOUND',
      'ORDER_TRANSACTION_MISMATCH',
      'TRANSACTION_IN_UNEXPECTED_STATE',
      'ORDER_NOT_FOUND',
    ]) {
      const result = orderGatewayPaymentCompletionSchema.safeParse({
        error_code: code,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown error code', () => {
    const result = orderGatewayPaymentCompletionSchema.safeParse({
      error_code: 'SOMETHING_ELSE',
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-boolean flags', () => {
    const result = orderGatewayPaymentCompletionSchema.safeParse({
      order_updated: 'yes',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    {},
    { already_completed: true },
    { order_updated: true },
  ])('rejects an incomplete success payload: %j', (payload) => {
    expect(orderGatewayPaymentCompletionSchema.safeParse(payload).success).toBe(
      false
    );
  });
});
