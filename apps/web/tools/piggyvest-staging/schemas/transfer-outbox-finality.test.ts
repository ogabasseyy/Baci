import { describe, expect, it } from 'vitest';
import { transferOutboxFinalitySchemas } from './transfer-outbox-finality';

describe('transferOutboxFinalitySchemas', () => {
  it('converts PostgreSQL bigint text to a safe positive integer', () => {
    const result = transferOutboxFinalitySchemas.expectedRow.parse({
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      reference: 'outflow-001',
      amount_kobo: '500000',
      currency: 'NGN',
      source_wallet_id: 'source-wallet-001',
      destination_ref: '058:6789',
      direction: 'bank',
      provider_customer_id: 'provider-customer-001',
      business_id: 'business-001',
      integration_id: 'integration-001',
      status: 'submitted',
    });

    expect(result.amount_kobo).toBe(500000);
    expect(result.customer_id).toBe('c0065070-dc32-45d2-9c01-871a27abfd10');
  });

  it.each([
    '0',
    '-1',
    '01',
    '500000.0',
    '9007199254740992',
  ])('rejects a non-canonical or unsafe PostgreSQL bigint value %s', (amount_kobo) => {
    const result = transferOutboxFinalitySchemas.expectedRow.safeParse({
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      reference: 'outflow-001',
      amount_kobo,
      currency: 'NGN',
      source_wallet_id: 'source-wallet-001',
      destination_ref: '058:6789',
      direction: 'bank',
      provider_customer_id: 'provider-customer-001',
      business_id: 'business-001',
      integration_id: 'integration-001',
      status: 'submitted',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.every((issue) => issue.path[0] === 'amount_kobo')
      ).toBe(true);
    }
  });

  it('rejects an unexpected compare-and-set result row shape', () => {
    expect(
      transferOutboxFinalitySchemas.terminalOutcomeRow.safeParse({
        outcome: 'applied',
        provider_transaction_id: 'provider-transaction-001',
      }).success
    ).toBe(false);
  });
});
