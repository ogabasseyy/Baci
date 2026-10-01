import { describe, expect, it } from 'vitest';
import { merchantInvoicePartialPaymentCompletionSchema } from '@/schemas/merchant-invoice-partial-payment-completion';

describe('merchantInvoicePartialPaymentCompletionSchema', () => {
  it('parses a freshly recorded partial payment', () => {
    const result = merchantInvoicePartialPaymentCompletionSchema.safeParse({
      outcome: 'partial_recorded',
      already_completed: false,
      amount_applied: 300000,
      amount_paid: 300000,
      balance_due: 535000,
      order_number: 'ORD-1',
      payment_status: 'partially_paid',
      shipping_status: 'pending',
    });

    expect(result.success).toBe(true);
  });

  it('parses an idempotent replay even if the order was paid later', () => {
    const result = merchantInvoicePartialPaymentCompletionSchema.safeParse({
      outcome: 'partial_recorded',
      already_completed: true,
      amount_applied: 300000,
      amount_paid: 835000,
      balance_due: 0,
      order_number: 'ORD-1',
      payment_status: 'paid',
      shipping_status: 'processing',
    });

    expect(result.success).toBe(true);
  });

  it.each([
    'amount_now_completes_order',
    'exact_completion_replay',
    'order_terminal',
  ])('parses a %s standard-completion handoff', (reason) => {
    expect(
      merchantInvoicePartialPaymentCompletionSchema.safeParse({
        outcome: 'standard_completion',
        reason,
      }).success
    ).toBe(true);
  });

  it('parses a fail-closed review outcome', () => {
    expect(
      merchantInvoicePartialPaymentCompletionSchema.safeParse({
        outcome: 'review_required',
        error_code: 'AMOUNT_EXCEEDS_REMAINING_BALANCE',
        remaining_balance: 100000,
      }).success
    ).toBe(true);
  });

  it.each([
    {},
    { outcome: 'partial_recorded', amount_paid: 300000 },
    { outcome: 'standard_completion', reason: 'guess' },
    { outcome: 'review_required' },
  ])('rejects an incomplete or unknown RPC payload: %j', (payload) => {
    expect(
      merchantInvoicePartialPaymentCompletionSchema.safeParse(payload).success
    ).toBe(false);
  });
});
