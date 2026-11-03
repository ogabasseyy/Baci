import { beforeEach, expect, it, vi } from 'vitest';
import {
  runGoalCancelOutflowReconciliation,
  runGoalCancelReconciliation,
} from './goal-cancel-reconciliation';
import {
  goalWallet,
  inflowConfiguration,
  operationId,
  record,
  reference,
  reservation,
  token,
} from './goal-cancel-reconciliation.test-support';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';

vi.mock('server-only', () => ({}));
const alert = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: alert }));
const retrieveWallet = vi.hoisted(() => vi.fn());
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: retrieveWallet }));
const evidenceExecute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-evidence-executor', () => ({
  createPrimaryWalletEvidenceExecutor: () => evidenceExecute,
}));
beforeEach(() => {
  retrieveWallet.mockResolvedValue(goalWallet(0));
});

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
