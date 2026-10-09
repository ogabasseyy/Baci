import { beforeEach, expect, it, vi } from 'vitest';
import { runPrimaryWalletSavingsOutflowReconciliation } from './primary-wallet-savings-outflow-reconciliation';

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
  reference: 'pvb-save-reference',
  businessId: 'business',
  providerCustomerId: 'source-customer',
};
function verifiedResponse(status: 'successful' | 'failed') {
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
it('resolves unmatched when no dispatched operation carries the reference', async () => {
  mockLookup(null);
  const fetchImplementation = vi.fn();
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['pvb-save-unknown'],
      fetchImplementation,
    })
  ).toBe('unmatched');
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('skips malformed references instead of trapping the event in retries', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi.fn();
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['', 'x'.repeat(201)],
      fetchImplementation,
    })
  ).toBe('unmatched');
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('confirms a matched dispatched operation through the shared proof', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(verifiedResponse('successful'));
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: ['unrelated-candidate', reservation.reference],
      fetchImplementation,
    })
  ).toBe('confirmed');
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
    `reference=${encodeURIComponent(reservation.reference)}`
  );
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      String(statement).includes('settle_savings')
    )
  ).toBe(true);
});
it('releases a matched operation the provider reports as failed', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(verifiedResponse('failed'));
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reservation.reference],
      fetchImplementation,
    })
  ).toBe('cancelled');
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      String(statement).includes('release_failed_savings')
    )
  ).toBe(true);
});
it('stays pending when the provider re-query cannot confirm', async () => {
  mockLookup(reservation);
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(new Response('private detail', { status: 404 }));
  expect(
    await runPrimaryWalletSavingsOutflowReconciliation({
      configuration,
      providerToken: 'test-token',
      references: [reservation.reference],
      fetchImplementation,
    })
  ).toBe('pending');
});
