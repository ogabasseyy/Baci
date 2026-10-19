import { describe, expect, it, vi } from 'vitest';
import { createDurableOutflowStore } from './transfer-outbox-finality';
import { PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS } from './transfer-outbox-finality-statements';
import { createConfiguredTransactionStatusRunner } from './transfer-reconciliation-status';

const customerId = 'c0065070-dc32-45d2-9c01-871a27abfd10';
const expected = {
  reference: 'synthetic-outflow-001',
  amountKobo: 500_000,
  currency: 'NGN' as const,
  sourceWalletId: 'source-wallet-001',
  destinationWalletId: '058:6789',
  direction: 'bank' as const,
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
  status: 'submitted' as const,
};

describe('configured TSQ runner with durable outflow store', () => {
  it('CASes only after the store returns the persisted scoped customer identity', async () => {
    const execute = vi.fn(async (statement: string) => {
      if (
        statement === PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected.text
      ) {
        return {
          rows: [
            {
              customer_id: customerId,
              reference: expected.reference,
              amount_kobo: String(expected.amountKobo),
              currency: expected.currency,
              source_wallet_id: expected.sourceWalletId,
              destination_ref: expected.destinationWalletId,
              direction: expected.direction,
              provider_customer_id: expected.providerCustomerId,
              business_id: expected.businessId,
              integration_id: expected.integrationId,
              status: expected.status,
            },
          ],
        };
      }
      return { rows: [{ outcome: 'applied' }] };
    });
    const store = createDurableOutflowStore({
      execute,
      expectedSystemId: '123456789',
      businessId: expected.businessId,
      integrationId: expected.integrationId,
    });
    const runner = createConfiguredTransactionStatusRunner({
      expectedSystemId: '123456789',
      businessId: expected.businessId,
      integrationId: expected.integrationId,
      query: vi.fn(async () => ({
        reference: expected.reference,
        status: 'success',
        amount: expected.amountKobo,
        recipient: '0123456789',
        bank: 'GTBank',
        created_at: '2026-09-26T12:00:00Z',
        customerId,
        currency: expected.currency,
        sourceWalletId: expected.sourceWalletId,
        destinationWalletId: expected.destinationWalletId,
        direction: expected.direction,
        providerCustomerId: expected.providerCustomerId,
        businessId: expected.businessId,
        integrationId: expected.integrationId,
        providerTransactionId: 'provider-transaction-001',
      })),
      stagingConfig: {
        apiBaseUrl: 'https://staging.piggyvest.business',
        apiSecret: 'staging-token',
        expectedBusinessId: expected.businessId,
      },
    });

    await expect(
      runner.reconcile({
        ...store,
        reference: expected.reference,
        customerId,
        providerCustomerId: expected.providerCustomerId,
      })
    ).resolves.toEqual({ outcome: 'applied', status: 'succeeded' });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.readExpected.text,
      [
        '123456789',
        expected.reference,
        expected.providerCustomerId,
        expected.businessId,
        expected.integrationId,
      ]
    );
    expect(execute).toHaveBeenCalledWith(
      PIGGYVEST_OUTFLOW_FINALITY_STATEMENTS.compareAndSet.text,
      expect.any(Array)
    );
  });
});
