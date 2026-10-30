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
            : statement.includes('save_savings_reconciliation_checkpoint') ||
                statement.includes('finish_savings_reconciliation_checkpoint')
              ? true
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
  const providerResponse = {
    status: true,
    data: {
      status: 'successful',
      id: 'transaction',
      internal_reference: 'transaction',
      reference: 'provider-reference',
      third_party_reference: 'reference',
      amount: 2000,
      fee: 0,
      customer_id:
        environment === 'production' ? 'business' : 'source-customer',
      source_wallet: 'source',
      destination_wallet: 'destination',
    },
  };
  const fetchImplementation = vi.fn();
  fetchImplementation.mockResolvedValueOnce(
    new Response(JSON.stringify(providerResponse))
  );
  fetchImplementation
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
            ...providerResponse.data,
            third_party_reference: 'reference',
            ...(environment === 'production' ? { category: 'p2p' } : {}),
          },
        })
      )
    );
  const result = await runPrimaryWalletSavingsReconciliation({
    configuration: { ...configuration, environment },
    providerToken: 'test-token',
    operationId,
    fetchImplementation,
  });
  expect(result).toEqual({ status: 'confirmed' });
  expect(fetchImplementation).toHaveBeenCalledWith(
    `${origin}/api/v1/transaction/verify?reference=reference&wallet_id=source`,
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    })
  );
  expect(fetchImplementation).toHaveBeenNthCalledWith(
    3,
    `${origin}/api/v1/transaction/transaction?wallet_id=source`,
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    })
  );
  expect(fetchImplementation).toHaveBeenCalledTimes(3);
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

it.each([
  'success',
  'failed',
] as const)('keeps the documented minimal production TSQ %s response pending', async (status) => {
  const fetchImplementation = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: true,
        message: 'Transaction status retrieved',
        data: {
          reference: 'reference',
          status,
          amount: 2000,
          recipient: 'destination',
          bank: 'PiggyVest',
          created_at: '2024-03-25T12:00:00Z',
        },
      })
    )
  );

  expect(
    await runPrimaryWalletSavingsReconciliation({
      configuration: { ...configuration, environment: 'production' },
      providerToken: 'test-token',
      operationId,
      fetchImplementation,
    })
  ).toEqual({ status: 'pending' });
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(fetchImplementation).toHaveBeenCalledWith(
    'https://api.piggyvest.business/api/v1/transaction/verify?reference=reference&wallet_id=source',
    expect.objectContaining({ method: 'GET', redirect: 'error' })
  );
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      /settle_savings|release_failed_savings/.test(String(statement))
    )
  ).toBe(false);
});
