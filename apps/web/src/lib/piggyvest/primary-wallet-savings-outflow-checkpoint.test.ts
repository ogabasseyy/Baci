import { expect, it, vi } from 'vitest';
import { runPrimaryWalletSavingsOutflowReconciliation } from './primary-wallet-savings-outflow-reconciliation';

const query = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({
  Client: class {
    connect = async () => {};
    query = query;
    end = async () => {};
  },
}));

it('uses the shared fenced checkpoint wrapper for production outflow reconciliation', async () => {
  const operationId = '11111111-1111-4111-8111-111111111111';
  const reference = 'pvb-save-reference';
  const integrationId = '22222222-2222-4222-8222-222222222222';
  const login = 'baci_piggyvest_primary_evidence';
  const reservation = {
    operationId,
    goalId: '33333333-3333-4333-8333-333333333333',
    amountKobo: 2000,
    sourceWalletId: 'source',
    destinationWalletId: 'destination',
    reference,
    businessId: 'business',
    providerCustomerId: 'source-customer',
  };
  query.mockImplementation(async (statement: string) => ({
    rows: [
      {
        result:
          statement.includes('find_dispatched_savings_by_reference') ||
          statement.includes('read_dispatched_savings')
            ? reservation
            : statement.includes('claim_savings_reconciliation_checkpoint')
              ? {
                  status: 'acquired',
                  claimToken: '44444444-4444-4444-8444-444444444444',
                  state: {
                    stage: null,
                    fingerprint: null,
                    cursor: null,
                    pageDigest: null,
                  },
                }
              : statement.includes('settle_savings')
                ? 'confirmed'
                : true,
        database_name: 'postgres',
        login_name: login,
        role_name: login,
        safe: true,
        tls: true,
      },
    ],
  }));
  const configuration = {
    integrationId,
    environment: 'production',
    database: {
      host: 'db.example.com',
      port: 5432,
      name: 'postgres',
      login,
      password: 'test-only',
      certificateAuthority: 'test-ca',
    },
  };
  const fetchImplementation = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            status: 'successful',
            id: 'transaction',
            internal_reference: 'transaction',
            reference: 'provider-reference',
            third_party_reference: reference,
            amount: 2000,
            fee: 0,
            customer_id: 'business',
            source_wallet: 'source',
            destination_wallet: 'destination',
          },
        })
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            id: 'source',
            business_id: 'business',
            api_customer_id: 'source-customer',
            currency: 'NGN',
            status: 'active',
            is_frozen: false,
          },
        })
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            id: 'transaction',
            customer_id: 'business',
            source_wallet: 'source',
            destination_wallet: 'destination',
            status: 'successful',
            category: 'p2p',
            amount: 2000,
            fee: 0,
            reference: 'provider-reference',
            third_party_reference: reference,
          },
        })
      )
    );

  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reference],
      fetchImplementation,
    })
  ).toBe('confirmed');
  expect(fetchImplementation).toHaveBeenCalledTimes(3);
  expect(
    query.mock.calls.some(([statement]) =>
      String(statement).includes('claim_savings_reconciliation_checkpoint')
    )
  ).toBe(true);
  expect(
    query.mock.calls.some(([statement]) =>
      String(statement).includes('save_savings_reconciliation_checkpoint')
    )
  ).toBe(true);
  expect(
    query.mock.calls.some(([statement]) =>
      String(statement).includes('finish_savings_reconciliation_checkpoint')
    )
  ).toBe(true);
});
