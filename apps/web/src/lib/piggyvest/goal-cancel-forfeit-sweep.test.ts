import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as sql } from './goal-cancel-forfeit-statements';
import { sweepPendingGoalCancelForfeits } from './goal-cancel-forfeit-sweep';
import {
  configuration,
  evidence,
  goalId,
  integrationId,
  providerToken,
} from './goal-cancel-runtime.test-support';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transfer: vi.fn(),
  lookup: vi.fn(),
  reconcile: vi.fn(),
  alert: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('./wallets', () => ({ retrievePiggyvestWallet: mocks.retrieve }));
vi.mock('./primary-wallet-savings-executor', () => ({
  createPrimaryWalletSavingsExecutor: () => mocks.execute,
}));
vi.mock('./transfers', () => ({ transferToWallet: mocks.transfer }));
vi.mock('./primary-wallet-savings-transfer-lookup', () => ({
  lookupSavingsTransferReference: mocks.lookup,
}));
vi.mock('./goal-cancel-forfeit-reconciliation', () => ({
  runGoalCancelForfeitReconciliation: mocks.reconcile,
}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mocks.alert }));

const opA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const opB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const forfeitId = '77777777-7777-4777-8777-777777777777';
const forfeit = {
  operationId: forfeitId,
  goalId,
  amountKobo: 12000,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'interest-wallet',
  reference: `pvb-forfeit-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};
const input = (allowNewTransfers: boolean) => ({
  configuration,
  reconciliationConfiguration: evidence,
  providerToken,
  allowNewTransfers,
});
function db(...results: unknown[]) {
  mocks.execute.mockReset();
  for (const result of results)
    mocks.execute.mockResolvedValueOnce({ rows: [{ result }] });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIGGYVEST_INTEREST_WALLET_ID', 'interest-wallet');
  vi.stubEnv('PIGGYVEST_INTEREST_WALLET_OWNER_ID', 'ogabassey');
  mocks.transfer.mockResolvedValue({ accepted: true });
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
  mocks.retrieve.mockResolvedValue({
    id: 'interest-wallet',
    business_id: 'business',
    api_customer_id: 'ogabassey',
    currency: 'NGN',
    status: 'active',
  });
});

describe('bugfix: a webhook-confirmed cancel never sent its interest', () => {
  it('sends a forfeit nobody polled for and settles it', async () => {
    db(
      [{ operationId: opA, forfeitId, state: 'reserved', alert: false }],
      { status: 'claimed', forfeit },
      'posting'
    );
    expect(await sweepPendingGoalCancelForfeits(input(true))).toEqual({
      listed: 1,
      confirmed: 1,
      pending: 0,
      attention: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
    });
    expect(mocks.execute.mock.calls[0]).toEqual([
      sql.workerList,
      [integrationId, 'staging', '50', 'true'],
    ]);
    expect(mocks.execute.mock.calls[1]).toEqual([
      sql.workerClaim,
      [integrationId, 'staging', opA],
    ]);
    expect(mocks.transfer).toHaveBeenCalledOnce();
  });
});

it('sends nothing new while savings are switched off, but still settles in-flight forfeits', async () => {
  db(
    [
      { operationId: opA, forfeitId, state: 'reserved', alert: false },
      { operationId: opB, forfeitId, state: 'dispatched', alert: false },
    ],
    { status: 'pending', forfeitId }
  );
  expect(await sweepPendingGoalCancelForfeits(input(false))).toMatchObject({
    listed: 2,
    skipped: 1,
    confirmed: 1,
  });
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.reconcile).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: forfeitId })
  );
});

it('pages an overdue in-flight forfeit, then acknowledges the page', async () => {
  db(
    [{ operationId: opB, forfeitId, state: 'dispatched', alert: true }],
    true,
    {
      status: 'pending',
      forfeitId,
    }
  );
  await sweepPendingGoalCancelForfeits(input(false));
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_overdue', operationId: opB }
  );
  expect(mocks.execute.mock.calls[1]).toEqual([
    sql.workerAck,
    // Only the forfeit that was paged, never its siblings.
    [integrationId, 'staging', forfeitId],
  ]);
  // Regression: the alert is recorded as sent only after it was emitted.
  expect(mocks.alert.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.execute.mock.invocationCallOrder[1]
  );
});

it('counts a failed page acknowledgement as a failure and still drives the forfeit', async () => {
  mocks.execute.mockReset();
  mocks.execute
    .mockResolvedValueOnce({
      rows: [
        {
          result: [
            { operationId: opB, forfeitId, state: 'dispatched', alert: true },
          ],
        },
      ],
    })
    .mockRejectedValueOnce(new Error('db'))
    .mockResolvedValueOnce({
      rows: [{ result: { status: 'pending', forfeitId } }],
    });
  expect(await sweepPendingGoalCancelForfeits(input(false))).toMatchObject({
    failed: 1,
    confirmed: 1,
  });
  expect(mocks.alert).toHaveBeenCalledOnce();
});

it('counts a failing forfeit and carries on with the next', async () => {
  mocks.execute.mockReset();
  mocks.execute
    .mockResolvedValueOnce({
      rows: [
        {
          result: [
            { operationId: opA, forfeitId, state: 'reserved', alert: false },
            { operationId: opB, forfeitId, state: 'dispatched', alert: false },
          ],
        },
      ],
    })
    .mockRejectedValueOnce(new Error('db'))
    .mockResolvedValueOnce({
      rows: [{ result: { status: 'pending', forfeitId } }],
    });
  expect(await sweepPendingGoalCancelForfeits(input(true))).toMatchObject({
    failed: 1,
    confirmed: 1,
  });
});

it('refuses evidence bound to another integration', async () => {
  await expect(
    sweepPendingGoalCancelForfeits({
      ...input(true),
      reconciliationConfiguration: {
        ...evidence,
        integrationId: '99999999-9999-4999-8999-999999999999',
      },
    })
  ).rejects.toThrow('Goal cancel forfeit sweep binding unavailable');
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('counts a stuck forfeit as needing attention, not as ordinary pending work', async () => {
  db(
    [{ operationId: opA, forfeitId, state: 'reserved', alert: false }],
    { status: 'unavailable', forfeitId, alert: true },
    true
  );
  expect(await sweepPendingGoalCancelForfeits(input(true))).toMatchObject({
    attention: 1,
    pending: 0,
  });
  // Paged, then acknowledged by the forfeit id through the worker statement.
  expect(mocks.execute.mock.calls[2]).toEqual([
    sql.workerAck,
    [integrationId, 'staging', forfeitId],
  ]);
});

it('starts no new forfeit once the deadline has passed', async () => {
  db(
    [
      { operationId: opA, forfeitId, state: 'reserved', alert: false },
      { operationId: opB, forfeitId, state: 'reserved', alert: false },
    ],
    { status: 'claimed', forfeit },
    'posting'
  );
  let clock = 1000;
  const result = await sweepPendingGoalCancelForfeits({
    ...input(true),
    deadlineAt: 1500,
    now: () => {
      const current = clock;
      clock += 1000;
      return current;
    },
  });
  expect(result).toMatchObject({ listed: 2, confirmed: 1, deferred: 1 });
  expect(mocks.transfer).toHaveBeenCalledOnce();
});

it('pages an overdue forfeit even when the deadline defers its item', async () => {
  db([{ operationId: opB, forfeitId, state: 'dispatched', alert: true }], true);
  const result = await sweepPendingGoalCancelForfeits({
    ...input(true),
    deadlineAt: 0,
    now: () => 1,
  });
  expect(result).toMatchObject({ listed: 1, deferred: 1 });
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_overdue', operationId: opB }
  );
});

it('lists only in-flight forfeits while new transfers are off', async () => {
  db([]);
  await sweepPendingGoalCancelForfeits(input(false));
  expect(mocks.execute.mock.calls[0][1]).toEqual([
    integrationId,
    'staging',
    '50',
    'false',
  ]);
});

it('pages a review nobody was paged about and drives nothing for it', async () => {
  db(
    [{ operationId: opA, forfeitId, state: 'needs_review', alert: true }],
    true
  );
  expect(await sweepPendingGoalCancelForfeits(input(true))).toMatchObject({
    listed: 1,
    attention: 1,
  });
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_needs_review', operationId: opA }
  );
  expect(mocks.transfer).not.toHaveBeenCalled();
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  expect(mocks.execute.mock.calls[1][0]).toBe(sql.workerAck);
});
