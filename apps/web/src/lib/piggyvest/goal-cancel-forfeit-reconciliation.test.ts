import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  runGoalCancelForfeitOutflowReconciliation,
  runGoalCancelForfeitReconciliation,
} from './goal-cancel-forfeit-reconciliation';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as sql } from './goal-cancel-forfeit-statements';

vi.mock('server-only', () => ({}));
const alert = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: alert }));
const retrieveWallet = vi.hoisted(() => vi.fn());
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: retrieveWallet }));
const evidenceExecute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-evidence-executor', () => ({
  createPrimaryWalletEvidenceExecutor: () => evidenceExecute,
}));

const integrationId = '11111111-1111-4111-8111-111111111111';
const operationId = '66666666-6666-4666-8666-666666666666';
const goalId = '55555555-5555-4555-8555-555555555555';
const reference = `pvb-forfeit-${goalId}`;
const providerId = createHash('sha256')
  .update('forfeit-provider-id')
  .digest('hex');
const token = createHash('sha256').update('forfeit-token').digest('hex');
const configuration = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: createHash('sha256').update('forfeit-evidence-db').digest('hex'),
    certificateAuthority: 'test-ca',
  },
};
const reservation = {
  operationId,
  goalId,
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference,
  businessId: 'business',
  providerCustomerId: 'customer',
};
function record(status: 'successful' | 'failed') {
  return {
    status: true,
    message: 'ok',
    data: {
      id: providerId,
      reference: providerId,
      internal_reference: providerId,
      third_party_reference: reference,
      status,
      amount: 12000,
      fee: 0,
      source_wallet: 'goal-wallet',
      destination_wallet: 'interest-wallet',
      customer_id: 'customer',
      business_id: 'business',
    },
  };
}
const goalWallet = (balance: number) => ({
  id: 'goal-wallet',
  api_customer_id: 'customer',
  business_id: 'business',
  currency: 'NGN',
  status: 'active',
  balance,
});
const fetchRecord = (status: 'successful' | 'failed') => async () =>
  new Response(JSON.stringify(record(status)));

beforeEach(() => {
  vi.clearAllMocks();
  evidenceExecute.mockReset();
  retrieveWallet.mockResolvedValue(goalWallet(0));
});

it('settles a verified forfeit through the forfeit statements only', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const outcome = await runGoalCancelForfeitReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('successful'),
  });
  expect(outcome).toEqual({ status: 'confirmed', needsReview: false });
  expect(evidenceExecute.mock.calls.map((call) => call[0])).toEqual([
    sql.readDispatched,
    sql.settle,
  ]);
  expect(alert).not.toHaveBeenCalled();
});

it('pages with the forfeit alert code when money is left in the goal wallet', async () => {
  retrieveWallet.mockResolvedValue(goalWallet(5));
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  const outcome = await runGoalCancelForfeitReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('successful'),
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  expect(
    JSON.parse(String(evidenceExecute.mock.calls[1][1][2])).residualKobo
  ).toBe(5);
  expect(alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    {
      reason: 'settle_conflict',
      operationId,
    }
  );
});

it('releases a provider-reported forfeit failure', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'released' }] });
  expect(
    await runGoalCancelForfeitReconciliation({
      configuration,
      providerToken: token,
      operationId,
      fetchImplementation: fetchRecord('failed'),
    })
  ).toEqual({ status: 'cancelled', needsReview: false });
  expect(evidenceExecute.mock.calls[1][0]).toBe(sql.release);
});

it('reconciles a forfeit named by an outflow webhook reference and skips other references', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: { operationId } }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const outcome = await runGoalCancelForfeitOutflowReconciliation({
    configuration,
    providerToken: token,
    references: [`pvb-cancel-${goalId}`, reference],
    fetchImplementation: fetchRecord('successful'),
  });
  expect(outcome).toBe('confirmed');
  expect(evidenceExecute.mock.calls.map((call) => call[0])).toEqual([
    sql.findByReference,
    sql.readDispatched,
    sql.settle,
  ]);
});

it('answers unmatched when no reference is a known forfeit', async () => {
  evidenceExecute.mockResolvedValueOnce({ rows: [{ result: null }] });
  expect(
    await runGoalCancelForfeitOutflowReconciliation({
      configuration,
      providerToken: token,
      references: [reference],
      fetchImplementation: fetchRecord('successful'),
    })
  ).toBe('unmatched');
});

it('bugfix: acknowledges a settle-conflict page after emitting it, so the sweep does not page the review again', async () => {
  retrieveWallet.mockResolvedValue(goalWallet(0));
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] })
    .mockResolvedValueOnce({ rows: [{ result: true }] });
  await runGoalCancelForfeitReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('successful'),
  });
  expect(alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'settle_conflict', operationId }
  );
  const ack = evidenceExecute.mock.calls.findIndex(
    (call) => call[0] === sql.ack
  );
  expect(evidenceExecute.mock.calls[ack]).toEqual([
    sql.ack,
    [integrationId, 'staging', operationId],
  ]);
  expect(alert.mock.invocationCallOrder[0]).toBeLessThan(
    evidenceExecute.mock.invocationCallOrder[ack]
  );
});

it('bugfix: acknowledges the replacement row a failed-record release sent to review, not the proof row', async () => {
  const reviewId = '88888888-8888-4888-8888-888888888888';
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: `conflict:${reviewId}` }] })
    .mockResolvedValueOnce({ rows: [{ result: true }] });
  await runGoalCancelForfeitReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('failed'),
  });
  expect(alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'release_conflict', operationId }
  );
  expect(evidenceExecute.mock.calls.at(-1)).toEqual([
    sql.ack,
    [integrationId, 'staging', reviewId],
  ]);
});

it('bugfix: acknowledges the proof row and every replacement a late success froze', async () => {
  const frozenA = '88888888-8888-4888-8888-888888888888';
  const frozenB = '99999999-9999-4999-8999-999999999999';
  retrieveWallet.mockResolvedValue(goalWallet(0));
  evidenceExecute.mockReset();
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({
      rows: [{ result: `conflict:${frozenA},${frozenB}` }],
    })
    .mockResolvedValue({ rows: [{ result: true }] });
  await runGoalCancelForfeitReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('successful'),
  });
  expect(alert).toHaveBeenCalledOnce();
  expect(
    evidenceExecute.mock.calls
      .filter((call) => call[0] === sql.ack)
      .map((call) => call[1][2])
  ).toEqual([operationId, frozenA, frozenB]);
});
