import { describe, expect, it } from 'vitest';
import { oxygenWebhookSchema } from './oxygen-webhook';

const transaction = {
  phone_number: '08000000000',
  transaction_reference: 'synthetic-transaction',
  amount_deducted: '28000.00',
  amount_sent: '28000.00',
  loan_request_reference: 'fe448e69-9e01-47b6-a1f9-f90ab6455ea8',
};

describe('oxygenWebhookSchema transaction types', () => {
  it.each([
    'split_payment',
    'repayment_setup',
    'loan_repayment',
    'transaction',
  ])('accepts and preserves %s', (webhook_type) => {
    const payload = { ...transaction, webhook_type };
    expect(oxygenWebhookSchema.parse(payload)).toEqual(payload);
  });

  it('accepts a legacy transaction without a type', () => {
    expect(oxygenWebhookSchema.parse(transaction)).toEqual(transaction);
  });

  it.each([
    'unknown',
    'partner_settlement',
    'address_status_update',
    null,
  ])('rejects a transaction payload with type %s', (webhook_type) => {
    expect(
      oxygenWebhookSchema.safeParse({ ...transaction, webhook_type }).success
    ).toBe(false);
  });
});
