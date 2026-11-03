import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  createGoalCancelEvidenceStore,
  runGoalCancelOutflowReconciliation,
  runGoalCancelReconciliation,
} from './goal-cancel-reconciliation';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';

vi.mock('server-only', () => ({}));
const alert = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: alert }));
const retrieveWallet = vi.hoisted(() => vi.fn());
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: retrieveWallet }));
beforeEach(() => {
  retrieveWallet.mockResolvedValue({ balance: 0 });
});
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

// A conflict from settle (for example a late success while a newer attempt is
// live) means PiggyVest moved the money but our books refused it: a person
// must see it, and the status path must not call it released or a plain wait.
it('alerts an operator and flags needs-review when settling a verified record conflicts', async () => {
  alert.mockClear();
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  const outcome = await runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('successful'))),
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  expect(alert).toHaveBeenCalledOnce();
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
    reason: 'settle_conflict',
    operationId,
  });
});

it('alerts an operator when releasing a failed record conflicts', async () => {
  alert.mockClear();
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  const outcome = await runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('failed'))),
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
    reason: 'release_conflict',
    operationId,
  });
});

it('raises no alert and no flag for a clean settlement or a duplicate', async () => {
  alert.mockClear();
  for (const answer of ['confirmed', 'duplicate']) {
    evidenceExecute.mockReset();
    evidenceExecute
      .mockResolvedValueOnce({ rows: [{ result: reservation }] })
      .mockResolvedValueOnce({ rows: [{ result: answer }] });
    expect(
      await runGoalCancelReconciliation({
        configuration: inflowConfiguration,
        providerToken: token,
        operationId,
        fetchImplementation: async () =>
          new Response(JSON.stringify(record('successful'))),
      })
    ).toEqual({ status: 'confirmed', needsReview: false });
  }
  expect(alert).not.toHaveBeenCalled();
});

it('alerts on a webhook-driven settlement conflict too', async () => {
  alert.mockClear();
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: { operationId } }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  expect(
    await runGoalCancelOutflowReconciliation({
      configuration: inflowConfiguration,
      providerToken: token,
      references: [reference],
      fetchImplementation: async () =>
        new Response(JSON.stringify(record('successful'))),
    })
  ).toBe('pending');
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
    reason: 'settle_conflict',
    operationId,
  });
});

// A settlement that raises inside the database (for example a refund wallet
// that belongs to another merchant) is not transient: PiggyVest already moved
// the money. It must page a person and surface needs-review, while the next
// status check still retries from the stored attempt.
it.each([
  ['successful', 'settle_failed'],
  ['failed', 'release_failed'],
] as const)('pages an operator when a verified %s record raises in the database', async (status, reason) => {
  alert.mockClear();
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockRejectedValueOnce(new Error('refund wallet unavailable'));
  const outcome = await runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record(status))),
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  expect(alert).toHaveBeenCalledOnce();
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
    reason,
    operationId,
  });
});

it('stays retryable after a settlement raise: the next check settles', async () => {
  alert.mockClear();
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockRejectedValueOnce(new Error('connection reset'))
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const run = () =>
    runGoalCancelReconciliation({
      configuration: inflowConfiguration,
      providerToken: token,
      operationId,
      fetchImplementation: async () =>
        new Response(JSON.stringify(record('successful'))),
    });
  expect(await run()).toEqual({ status: 'pending', needsReview: true });
  expect(await run()).toEqual({ status: 'confirmed', needsReview: false });
});

// Coordinator item 4: once the transfer is verified, the goal wallet is
// re-read. A balance above 0 (a credit landed between the snapshot and the
// transfer) is sent with the settlement so the database keeps the goal open
// for review instead of settling it at zero, and a person is paged.
it('sends a residual provider balance with the settlement and pages an operator', async () => {
  alert.mockClear();
  evidenceExecute.mockReset();
  retrieveWallet.mockReset();
  retrieveWallet.mockResolvedValue({ balance: 4200 });
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  const outcome = await runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('successful'))),
  });
  expect(retrieveWallet).toHaveBeenCalledWith(
    expect.objectContaining({ token }),
    'goal-wallet'
  );
  const settleCall = evidenceExecute.mock.calls[1];
  expect(JSON.parse(settleCall[1][2])).toMatchObject({
    operationId,
    residualKobo: 4200,
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  expect(alert).toHaveBeenCalledOnce();
});

it('sends no residual when the goal wallet is empty', async () => {
  evidenceExecute.mockReset();
  retrieveWallet.mockReset();
  retrieveWallet.mockResolvedValue({ balance: 0 });
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  await runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('successful'))),
  });
  expect(JSON.parse(evidenceExecute.mock.calls[1][1][2])).not.toHaveProperty(
    'residualKobo'
  );
});

it('pages and stays retryable when the goal balance cannot be re-read', async () => {
  alert.mockClear();
  evidenceExecute.mockReset();
  retrieveWallet.mockReset();
  retrieveWallet.mockRejectedValue(new Error('provider down'));
  evidenceExecute.mockResolvedValueOnce({ rows: [{ result: reservation }] });
  const outcome = await runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('successful'))),
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  expect(evidenceExecute).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
    reason: 'settle_failed',
    operationId,
  });
});
