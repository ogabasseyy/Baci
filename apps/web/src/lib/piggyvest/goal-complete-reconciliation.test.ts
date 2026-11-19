import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  runGoalCompleteOutflowReconciliation,
  runGoalCompleteReconciliation,
} from './goal-complete-reconciliation';
import { GOAL_COMPLETE_STATEMENTS as sql } from './goal-complete-statements';

vi.mock('server-only', () => ({}));
const alert = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: alert }));
const retrieveWallet = vi.hoisted(() => vi.fn());
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: retrieveWallet }));
const purchaseAlert = vi.hoisted(() => vi.fn());
vi.mock('./goal-purchase-request-alert', () => ({
  alertGoalPurchaseRequest: purchaseAlert,
}));
const evidenceExecute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-evidence-executor', () => ({
  createPrimaryWalletEvidenceExecutor: () => evidenceExecute,
}));

const integrationId = '11111111-1111-4111-8111-111111111111';
const operationId = '66666666-6666-4666-8666-666666666666';
const goalId = '55555555-5555-4555-8555-555555555555';
const reference = `pvb-complete-${goalId}`;
const providerId = createHash('sha256').update('s7-provider-id').digest('hex');
const token = createHash('sha256').update('s7-token').digest('hex');
const configuration = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: createHash('sha256').update('s7-evidence-db').digest('hex'),
    certificateAuthority: 'test-ca',
  },
};
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
      amount: 250000,
      fee: 0,
      source_wallet: 'goal-wallet',
      destination_wallet: 'main-wallet',
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
  purchaseAlert.mockResolvedValue('alerted');
});

it('settles a verified success through the complete statements only', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const outcome = await runGoalCompleteReconciliation({
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

it('sends the residual provider balance with the settlement so the database records review', async () => {
  retrieveWallet.mockResolvedValue(goalWallet(4200));
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  const outcome = await runGoalCompleteReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('successful'),
  });
  expect(outcome).toEqual({ status: 'pending', needsReview: true });
  const body = JSON.parse(String(evidenceExecute.mock.calls[1][1][2]));
  expect(body.residualKobo).toBe(4200);
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW', {
    reason: 'settle_conflict',
    operationId,
  });
});

it('releases a provider-reported failure and pages nobody', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'released' }] });
  const outcome = await runGoalCompleteReconciliation({
    configuration,
    providerToken: token,
    operationId,
    fetchImplementation: fetchRecord('failed'),
  });
  expect(outcome).toEqual({ status: 'cancelled', needsReview: false });
  expect(evidenceExecute.mock.calls[1][0]).toBe(sql.release);
  expect(alert).not.toHaveBeenCalled();
});

it('pages with the complete alert code when the database refuses the settlement', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockRejectedValueOnce(new Error('database unavailable'));
  // The failure is never concluded: the answer stays pending for the status
  // path, flagged so the customer is told it is under review.
  expect(
    await runGoalCompleteReconciliation({
      configuration,
      providerToken: token,
      operationId,
      fetchImplementation: fetchRecord('successful'),
    })
  ).toEqual({ status: 'pending', needsReview: true });
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW', {
    reason: 'settle_failed',
    operationId,
  });
});

it('reconciles a complete named by an outflow webhook reference', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: { operationId } }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  const outcome = await runGoalCompleteOutflowReconciliation({
    configuration,
    providerToken: token,
    references: ['bad ref with spaces\n'.repeat(40), reference],
    fetchImplementation: fetchRecord('successful'),
  });
  expect(outcome).toBe('confirmed');
  expect(evidenceExecute.mock.calls.map((call) => call[0])).toEqual([
    sql.findByReference,
    sql.readDispatched,
    sql.settle,
  ]);
  // The webhook settled it with nobody polling, so the owner is alerted here,
  // after the settlement that saved the purchase request.
  expect(purchaseAlert).toHaveBeenCalledWith({ configuration, operationId });
});

it('does not alert the owner for a webhook that releases or leaves the complete pending', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: { operationId } }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'released' }] });
  expect(
    await runGoalCompleteOutflowReconciliation({
      configuration,
      providerToken: token,
      references: [reference],
      fetchImplementation: fetchRecord('failed'),
    })
  ).toBe('cancelled');
  expect(purchaseAlert).not.toHaveBeenCalled();
});

it('still answers confirmed when the owner alert fails after a webhook settlement', async () => {
  purchaseAlert.mockRejectedValue(new Error('alert down'));
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: { operationId } }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  expect(
    await runGoalCompleteOutflowReconciliation({
      configuration,
      providerToken: token,
      references: [reference],
      fetchImplementation: fetchRecord('successful'),
    })
  ).toBe('confirmed');
});

it('reports unmatched when no reference names a goal complete', async () => {
  evidenceExecute.mockResolvedValue({ rows: [{ result: null }] });
  expect(
    await runGoalCompleteOutflowReconciliation({
      configuration,
      providerToken: token,
      references: [reference],
    })
  ).toBe('unmatched');
});
