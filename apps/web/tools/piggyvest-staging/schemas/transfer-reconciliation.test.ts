import { describe, expect, it } from 'vitest';
import {
  expectedOutflowOperationSchema,
  terminalEvidenceSchema,
  transactionStatusResultSchema,
} from './transfer-reconciliation';

const scopedOperation = {
  reference: 'synthetic-outflow-001',
  amountKobo: 500_000,
  currency: 'NGN',
  sourceWalletId: 'source-wallet-001',
  destinationWalletId: 'destination-wallet-001',
  direction: 'bank',
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
  status: 'submitted',
};

describe('transfer reconciliation schemas', () => {
  it('rejects an operation without provider integration scope', () => {
    expect(
      expectedOutflowOperationSchema.safeParse({
        ...scopedOperation,
        integrationId: undefined,
      }).success
    ).toBe(false);
  });

  it('rejects terminal evidence without a provider business identity', () => {
    const { status: _status, ...evidence } = scopedOperation;
    expect(
      terminalEvidenceSchema.safeParse({
        ...evidence,
        businessId: undefined,
      }).success
    ).toBe(false);
  });

  it('rejects malformed TSQ amounts before reconciliation', () => {
    expect(
      transactionStatusResultSchema.safeParse({
        reference: 'synthetic-outflow-001',
        status: 'success',
        amount: '500000',
        recipient: '0123456789',
        bank: 'GTBank',
        created_at: '2026-09-26T12:00:00Z',
      }).success
    ).toBe(false);
  });
});
