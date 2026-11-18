import { beforeEach, expect, it, vi } from 'vitest';
// Webhook outflow reconciliation while the provider's verify record lags
// its own webhook (incident 2026-11-17): bounded re-asks, then pending.
import { runPrimaryWalletSavingsOutflowReconciliation } from './primary-wallet-savings-outflow-reconciliation';

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => {};
    query = mocks.query;
    end = mocks.end;
  },
}));
// The goal-cancel settle path re-reads the goal wallet at the provider; the
// answer is mocked so no test depends on the network.
const wallets = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: wallets.retrieve }));
beforeEach(() => {
  wallets.retrieve.mockResolvedValue({
    id: 'source',
    api_customer_id: 'source-customer',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  });
});
const operationId = '11111111-1111-4111-8111-111111111111';
const configuration = {
  integrationId: '22222222-2222-4222-8222-222222222222',
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: 'test-only',
    certificateAuthority: 'test-ca',
  },
};
const reservation = {
  operationId,
  goalId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 2000,
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  reference: 'pvb-save-reference',
  businessId: 'business',
  providerCustomerId: 'source-customer',
};
function verifiedResponse(status: 'pending' | 'successful' | 'failed') {
  return new Response(
    JSON.stringify({
      status: true,
      data: {
        status,
        id: 'transaction',
        internal_reference: 'transaction',
        reference: 'provider-reference',
        third_party_reference: reservation.reference,
        amount: 2000,
        fee: 0,
        customer_id: 'source-customer',
        source_wallet: 'source',
        destination_wallet: 'destination',
      },
    })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockResolvedValue(undefined);
});
function mockLookup(result: unknown) {
  mocks.query.mockImplementation(
    async (statement: string, parameters?: unknown[]) => ({
      rows: [
        {
          result: statement.includes('find_dispatched_savings_by_reference')
            ? parameters?.includes(reservation.reference)
              ? result
              : null
            : statement.includes('read_dispatched_savings')
              ? parameters?.includes(operationId)
                ? reservation
                : null
              : statement.includes('release_failed_savings')
                ? 'released'
                : 'confirmed',
          database_name: 'postgres',
          login_name: configuration.database.login,
          role_name: configuration.database.login,
          safe: true,
          tls: true,
        },
      ],
    })
  );
}
it('stays pending when the provider re-query cannot confirm', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockImplementation(
      async () => new Response('private detail', { status: 404 })
    );
  const sleep = vi.fn(async () => {});
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reservation.reference],
      fetchImplementation,
      verifyRetry: { sleep },
    })
  ).toBe('pending');
  // The bounded re-asks ran (no real waiting) before staying pending.
  expect(fetchImplementation).toHaveBeenCalledTimes(4);
  expect(sleep).toHaveBeenCalledTimes(3);
});
it('confirms when the verify record turns terminal on a re-ask', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValueOnce(verifiedResponse('pending'))
    .mockResolvedValueOnce(verifiedResponse('successful'));
  const sleep = vi.fn(async () => {});
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reservation.reference],
      fetchImplementation,
      verifyRetry: { sleep },
    })
  ).toBe('confirmed');
  expect(fetchImplementation).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});
