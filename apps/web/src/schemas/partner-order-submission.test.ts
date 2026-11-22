import { describe, expect, it } from 'vitest';
import { orderSchema } from './partner-order-submission';

const input = {
  quote_id: '20000000-0000-4000-8000-000000000001',
  partner_order_id: 'example-order',
  recipient: {
    name: ' Example Buyer ',
    phone: '+2348000000000',
    email: 'buyer@example.invalid',
  },
  payment: {
    source: 'example_provider',
    reference: 'charge-reference',
    amount_minor: 171200,
    currency: 'NGN',
  },
};

describe('partner order submission schema', () => {
  it('parses quoted NGN payment and trims contact text', () => {
    expect(orderSchema.parse(input).recipient.name).toBe('Example Buyer');
  });

  it.each([
    { ...input, quote_id: 'missing' },
    { ...input, partner_order_id: 'x'.repeat(129) },
    { ...input, recipient: { ...input.recipient, phone: '08000000000' } },
    { ...input, recipient: { ...input.recipient, email: undefined } },
    { ...input, payment: { ...input.payment, amount_minor: 1.25 } },
    { ...input, payment: { ...input.payment, currency: 'USD' } },
    { ...input, merchant_id: 'another-store' },
  ])('rejects input outside the order contract', (invalid) => {
    expect(orderSchema.safeParse(invalid).success).toBe(false);
  });
});
