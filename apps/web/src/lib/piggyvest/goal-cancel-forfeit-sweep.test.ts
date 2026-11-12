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
}));
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
  mocks.transfer.mockResolvedValue({ accepted: true });
  mocks.reconcile.mockResolvedValue({ status: 'confirmed' });
});

describe('bugfix: a webhook-confirmed cancel never sent its interest', () => {
  it('sends a forfeit nobody polled for and settles it', async () => {
    db([{ operationId: opA, state: 'reserved', alert: false }], {
      status: 'claimed',
      forfeit,
    });
    expect(await sweepPendingGoalCancelForfeits(input(true))).toEqual({
      listed: 1,
      confirmed: 1,
      pending: 0,
      skipped: 0,
      failed: 0,
    });
    expect(mocks.execute.mock.calls[0]).toEqual([
      sql.workerList,
      [integrationId, 'staging', '50'],
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
      { operationId: opA, state: 'reserved', alert: false },
      { operationId: opB, state: 'dispatched', alert: false },
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

it('pages once for an overdue in-flight forfeit', async () => {
  db([{ operationId: opB, state: 'dispatched', alert: true }], {
    status: 'pending',
    forfeitId,
  });
  await sweepPendingGoalCancelForfeits(input(false));
  expect(mocks.alert).toHaveBeenCalledWith(
    'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    { reason: 'forfeit_overdue', operationId: opB }
  );
});

it('counts a failing forfeit and carries on with the next', async () => {
  mocks.execute.mockReset();
  mocks.execute
    .mockResolvedValueOnce({
      rows: [
        {
          result: [
            { operationId: opA, state: 'reserved', alert: false },
            { operationId: opB, state: 'dispatched', alert: false },
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
