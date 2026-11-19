import { describe, expect, it } from 'vitest';
import { redvaultOrderPaymentMethodRowsSchema } from '@/schemas/redvault-order-payment-method';

describe('redvaultOrderPaymentMethodRowsSchema', () => {
  it('accepts a row with a payment method', () => {
    expect(
      redvaultOrderPaymentMethodRowsSchema.safeParse([
        { payment_method: 'uba_redvault' },
      ]).success
    ).toBe(true);
  });

  it('accepts a row with a NULL payment method (staff-created invoice)', () => {
    expect(
      redvaultOrderPaymentMethodRowsSchema.safeParse([{ payment_method: null }])
        .success
    ).toBe(true);
  });

  it('accepts an empty result for a missing order', () => {
    expect(redvaultOrderPaymentMethodRowsSchema.safeParse([]).success).toBe(
      true
    );
  });

  it('rejects a non-array response', () => {
    expect(
      redvaultOrderPaymentMethodRowsSchema.safeParse({
        payment_method: 'paystack',
      }).success
    ).toBe(false);
  });

  it('rejects a row with a non-string payment method', () => {
    expect(
      redvaultOrderPaymentMethodRowsSchema.safeParse([{ payment_method: 42 }])
        .success
    ).toBe(false);
  });
});
