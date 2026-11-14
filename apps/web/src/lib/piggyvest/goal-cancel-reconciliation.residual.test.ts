import { beforeEach, expect, it, vi } from 'vitest';
import { runGoalCancelReconciliation } from './goal-cancel-reconciliation';
import {
  goalWallet,
  inflowConfiguration,
  operationId,
  record,
  reservation,
  token,
} from './goal-cancel-reconciliation.test-support';

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

beforeEach(() => {
  alert.mockClear();
  evidenceExecute.mockReset();
  retrieveWallet.mockReset();
  retrieveWallet.mockResolvedValue(goalWallet(0));
});

const run = () =>
  runGoalCancelReconciliation({
    configuration: inflowConfiguration,
    providerToken: token,
    operationId,
    fetchImplementation: async () =>
      new Response(JSON.stringify(record('successful'))),
  });
const settleBody = () => JSON.parse(evidenceExecute.mock.calls[1][1][2]);

// Once the transfer is verified, the goal wallet is re-read. A balance above 0
// (a credit landed between the snapshot and the transfer) is sent with the
// settlement so the database keeps the goal open for review instead of
// settling it at zero, and a person is paged.
it('sends a residual provider balance with the settlement and pages an operator', async () => {
  retrieveWallet.mockResolvedValue(goalWallet(4200));
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'conflict' }] });
  expect(await run()).toEqual({ status: 'pending', needsReview: true });
  expect(retrieveWallet).toHaveBeenCalledWith(
    expect.objectContaining({ token }),
    'goal-wallet'
  );
  expect(settleBody()).toMatchObject({ operationId, residualKobo: 4200 });
  expect(alert).toHaveBeenCalledOnce();
});

it('sends no residual when the goal wallet is empty', async () => {
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  await run();
  expect(settleBody()).not.toHaveProperty('residualKobo');
});

// A transient failure re-reading the balance (network, provider jitter) is not
// a settlement conflict. Nothing is concluded, nobody is paged, and the next
// status check retries from the stored attempt.
it('stays pending and silent when the goal balance cannot be re-read, then settles on the next check', async () => {
  retrieveWallet.mockRejectedValueOnce(new Error('provider down'));
  evidenceExecute
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: reservation }] })
    .mockResolvedValueOnce({ rows: [{ result: 'confirmed' }] });
  expect(await run()).toEqual({ status: 'pending', needsReview: false });
  expect(evidenceExecute).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
  expect(await run()).toEqual({ status: 'confirmed', needsReview: false });
});

// A read about a different wallet is never trusted: a zero balance from the
// wrong wallet must not settle the goal as cancelled-at-zero.
it.each([
  ['wallet id', { id: 'someone-elses-wallet' }],
  ['business', { business_id: 'another-business' }],
  ['provider customer', { api_customer_id: 'another-customer' }],
])('never settles on a balance read for another %s, and pages', async (_what, override) => {
  retrieveWallet.mockResolvedValue(goalWallet(0, override));
  evidenceExecute.mockResolvedValueOnce({ rows: [{ result: reservation }] });
  expect(await run()).toEqual({ status: 'pending', needsReview: true });
  expect(evidenceExecute).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledOnce();
  expect(alert).toHaveBeenCalledWith('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
    reason: 'settle_balance_mismatch',
    operationId,
  });
});
