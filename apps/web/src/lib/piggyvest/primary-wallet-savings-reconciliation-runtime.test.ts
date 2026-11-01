import { beforeEach, expect, it, vi } from 'vitest';
import { runPrimaryWalletSavingsReconciliation } from './primary-wallet-savings-reconciliation-runtime';

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => {};
    query = mocks.query;
    end = mocks.end;
  },
}));
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
  reference: 'reference',
  businessId: 'business',
  providerCustomerId: 'source-customer',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (statement: string) => ({
    rows: [
      {
        result: statement.includes('read_dispatched')
          ? reservation
          : 'confirmed',
        database_name: 'postgres',
        login_name: configuration.database.login,
        role_name: configuration.database.login,
        safe: true,
        tls: true,
      },
    ],
  }));
});
it.each([
  ['staging', 'https://staging.piggyvest.business'],
  ['production', 'https://api.piggyvest.business'],
] as const)('connects settlement to the %s provider instead of crossing environments', async (environment, origin) => {
  const fetchImplementation = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: true,
        data: {
          status: 'successful',
          id: 'transaction',
          internal_reference: 'transaction',
          reference: 'provider-reference',
          third_party_reference: 'reference',
          amount: 2000,
          fee: 0,
          customer_id: 'source-customer',
          source_wallet: 'source',
          destination_wallet: 'destination',
        },
      })
    )
  );
  expect(
    await runPrimaryWalletSavingsReconciliation({
      configuration: { ...configuration, environment },
      providerToken: 'test-token',
      operationId,
      fetchImplementation,
    })
  ).toEqual({ status: 'confirmed' });
  expect(fetchImplementation).toHaveBeenCalledWith(
    `${origin}/api/v1/transaction/verify?reference=reference&wallet_id=source`,
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    })
  );
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.stringContaining('settle_savings'),
    [
      configuration.integrationId,
      environment,
      expect.stringContaining('"providerTransactionId":"transaction"'),
    ]
  );
});
it('never settles after a provider HTTP error and does not expose its body', async () => {
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(new Response('private detail', { status: 404 }));
  expect(
    await runPrimaryWalletSavingsReconciliation({
      configuration,
      providerToken: 'test-token',
      operationId,
      fetchImplementation,
    })
  ).toEqual({ status: 'pending' });
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      statement.includes('settle_savings')
    )
  ).toBe(false);
});
