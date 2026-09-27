import { describe, expect, it } from 'vitest';
import { paymentInitFixtureSchema } from './payment-init-fixture-schema';

const validPaymentRequest = {
  merchant_id: '11111111-1111-4111-8111-111111111111',
  order_id: '44444444-4444-4444-8444-444444444444',
  customer_email: 'ada@example.test',
  customer_name: 'Ada Okon',
  customer_phone: '+2348031234567',
  gateway: 'korapay' as const,
};

describe('paymentInitFixtureSchema', () => {
  it('accepts the required guest payment-init contract with optional billing address', () => {
    expect(
      paymentInitFixtureSchema.safeParse(validPaymentRequest).success
    ).toBe(true);
  });

  it('rejects missing identity/contact fields and malformed gateway or billing address', () => {
    expect(
      paymentInitFixtureSchema.safeParse({ gateway: 'korapay' }).success
    ).toBe(false);
    expect(
      paymentInitFixtureSchema.safeParse({
        ...validPaymentRequest,
        gateway: 'unsupported',
      }).success
    ).toBe(false);
    expect(
      paymentInitFixtureSchema.safeParse({
        ...validPaymentRequest,
        billing_address: { country: 'NGA' },
      }).success
    ).toBe(false);
  });
});
