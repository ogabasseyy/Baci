import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  createGoalCancelEvidenceStore,
  runGoalCancelOutflowReconciliation,
} from './goal-cancel-reconciliation';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';

vi.mock('server-only', () => ({}));
const evidenceExecute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-evidence-executor', () => ({
  createPrimaryWalletEvidenceExecutor: () => evidenceExecute,
}));
const integrationId = '11111111-1111-4111-8111-111111111111';
const operationId = '66666666-6666-4666-8666-666666666666';
const goalId = '55555555-5555-4555-8555-555555555555';
const reference = `pvb-cancel-${goalId}`;
const reservation = {
  operationId,
  goalId,
  amountKobo: 250000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'main-wallet',
  reference,
  businessId: 'business',
  providerCustomerId: 'customer',
};
const providerId = createHash('sha256').update('s6-provider-id').digest('hex');
function record(status: 'successful' | 'failed', overrides = {}) {
  return {
    status: true,
    message: 'ok',
    data: {
      id: providerId,
      reference: providerId,
      internal_reference: providerId,
      third_party_reference: reference,
      status,
      amount: 250000,
      fee: 0,
      source_wallet: 'goal-wallet',
      destination_wallet: 'main-wallet',
      customer_id: 'customer',
      business_id: 'business',
      ...overrides,
    },
  };
}
function setup(rows: unknown[]) {
  const execute = vi.fn();
  for (const row of rows)
    execute.mockResolvedValueOnce({ rows: [{ result: row }] });
  const store = createGoalCancelEvidenceStore({
    integrationId,
    environment: 'staging',
    execute,
  });
  return { execute, store };
}

it('loads a dispatched attempt through the fixed evidence statement', async () => {
  const { execute, store } = setup([reservation]);
  expect(await store.loadDispatched(operationId)).toEqual(reservation);
  expect(execute).toHaveBeenCalledWith(sql.readDispatched, [
    integrationId,
    'staging',
    operationId,
  ]);
});

it('refuses a stored reservation without an amount', async () => {
  const { amountKobo: _amount, ...withoutAmount } = reservation;
  const { store } = setup([withoutAmount]);
  await expect(store.loadDispatched(operationId)).rejects.toThrow();
});

it('refuses an unexpected settlement answer', async () => {
  const { store } = setup(['approved']);
  await expect(store.settle({ status: 'verified' })).rejects.toThrow(
    'Goal cancel settlement unavailable'
  );
});

it('settles only on a verified successful provider record bound to the attempt', async () => {
  const { execute, store } = setup([reservation, 'confirmed']);
  const result = await reconcilePrimaryWalletSavings(operationId, {
    ...store,
    queryProvider: vi.fn().mockResolvedValue(record('successful')),
  });
  expect(result).toEqual({ status: 'confirmed' });
  const settleCall = execute.mock.calls.find(([text]) => text === sql.settle);
  expect(JSON.parse(settleCall?.[1][2] as string)).toEqual({
    providerTransactionId: providerId,
    operationId,
    reference,
    amountKobo: 250000,
    sourceWalletId: 'goal-wallet',
    destinationWalletId: 'main-wallet',
    businessId: 'business',
  });
});

it('releases only on a provider-reported failure', async () => {
  const { execute, store } = setup([reservation, 'released']);
  const result = await reconcilePrimaryWalletSavings(operationId, {
    ...store,
    queryProvider: vi.fn().mockResolvedValue(record('failed')),
  });
  expect(result).toEqual({ status: 'cancelled' });
  expect(execute.mock.calls.some(([text]) => text === sql.release)).toBe(true);
});

it.each([
  ['a 404 right after the submit', () => Promise.reject(new Error('404'))],
  [
    'a still-pending record',
    () => Promise.resolve(record('successful', { status: 'pending' })),
  ],
  [
    'a record for another amount',
    () => Promise.resolve(record('successful', { amount: 250001 })),
  ],
  [
    'a record for another destination',
    () =>
      Promise.resolve(record('successful', { destination_wallet: 'other' })),
  ],
  [
    'a record with a fee',
    () => Promise.resolve(record('successful', { fee: 5 })),
  ],
])('stays pending on %s and changes nothing', async (_name, query) => {
  const { execute, store } = setup([reservation]);
  const result = await reconcilePrimaryWalletSavings(operationId, {
    ...store,
    queryProvider: vi.fn(query),
  });
  expect(result).toEqual({ status: 'pending' });
  expect(
    execute.mock.calls.some(
      ([text]) => text === sql.settle || text === sql.release
    )
  ).toBe(false);
});

it('finds a dispatched or released-after-dispatch attempt by reference', async () => {
  const { execute, store } = setup([{ operationId }, null]);
  expect(await store.findByReference(reference)).toEqual({ operationId });
  expect(await store.findByReference('pvb-cancel-unknown')).toBeNull();
  expect(execute).toHaveBeenNthCalledWith(1, sql.findByReference, [
    integrationId,
    'staging',
    reference,
  ]);
});

it('refuses a malformed by-reference answer', async () => {
  const { store } = setup([{ operationId: 'nope' }]);
  await expect(store.findByReference(reference)).rejects.toThrow();
});

it('settles a released-after-dispatch attempt from a successful record (late success)', async () => {
  // The database returns the released-but-dispatched row to the loader; the
  // provider shows success, so the verified record is settled.
  const { execute, store } = setup([reservation, 'confirmed']);
  const outcome = await reconcilePrimaryWalletSavings(operationId, {
    ...store,
    queryProvider: async () => record('successful'),
  });
  expect(outcome).toEqual({ status: 'confirmed' });
  expect(execute.mock.calls[1][0]).toBe(sql.settle);
});

it('treats a failed record for an already released attempt as released (duplicate)', async () => {
  const { store } = setup([reservation, 'duplicate']);
  expect(
    await reconcilePrimaryWalletSavings(operationId, {
      ...store,
      queryProvider: async () => record('failed'),
    })
  ).toEqual({ status: 'cancelled' });
});

const inflowConfiguration = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: createHash('sha256').update('s6-evidence-db').digest('hex'),
    certificateAuthority: 'test-ca',
  },
};
const token = createHash('sha256').update('s6-outflow-token').digest('hex');

it('reconciles a goal cancel named by an outflow webhook reference without client polling', async () => {
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: { operationId } }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const outcome = await runGoalCancelOutflowReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    references: ['bad ref with spaces\n'.repeat(40), reference],
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('successful'))),
  });
  expect(outcome).toBe('confirmed');
  expect(evidenceExecute.mock.calls.map((call) => call[0])).toEqual([
    sql.findByReference,
    sql.readDispatched,
    sql.settle,
  ]);
});

it('reports unmatched when no reference names a goal cancel', async () => {
  evidenceExecute.mockReset();
  evidenceExecute.mockResolvedValue({ rows: [{ result: null }] });
  expect(
    await runGoalCancelOutflowReconciliation({
      configuration: inflowConfiguration,
      providerToken: token,
      references: [reference],
    })
  ).toBe('unmatched');
});
