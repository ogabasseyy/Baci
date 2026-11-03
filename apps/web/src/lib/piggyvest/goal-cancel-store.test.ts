import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';
import { createGoalCancelStore } from './goal-cancel-store';

vi.mock('server-only', () => ({}));
const scope = {
  integrationId: '11111111-1111-4111-8111-111111111111',
  environment: 'staging',
  merchantId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  businessId: 'business',
};
const scopeText = JSON.stringify(
  piggyvestPrimaryWalletStoreSchemas.scope.parse(scope)
);
const goalId = '55555555-5555-4555-8555-555555555555';
const operationId = '66666666-6666-4666-8666-666666666666';
const proof = createHash('sha256').update('s6-store-proof').digest('hex');

function store(rows: unknown) {
  const execute = vi.fn().mockResolvedValue({ rows });
  return { execute, store: createGoalCancelStore({ scope, execute }) };
}

it('issues the operation id through the fixed statement', async () => {
  const { execute, store: s } = store([
    { result: { status: 'issued', operationId, expiresAt: 'later' } },
  ]);
  expect(await s.issue(goalId)).toEqual({
    status: 'issued',
    operationId,
    expiresAt: 'later',
  });
  expect(execute).toHaveBeenCalledWith(sql.issue, [scopeText, goalId]);
});

it('reserves with the PIN proof in the same statement', async () => {
  const reservation = { operationId };
  const { execute, store: s } = store([
    { result: { status: 'claimed', reservation } },
  ]);
  expect(await s.reserve({ goalId, operationId }, proof)).toEqual({
    status: 'claimed',
    reservation,
  });
  expect(execute).toHaveBeenCalledWith(sql.reserve, [
    scopeText,
    JSON.stringify({ goalId, operationId }),
    proof,
  ]);
});

it('refuses a missing or malformed proof before any statement runs', async () => {
  const { execute, store: s } = store([]);
  await expect(s.reserve({ goalId, operationId }, '')).rejects.toThrow();
  await expect(s.reserve({ goalId, operationId }, 'abc')).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it('rejects an unexpected database answer instead of passing it on', async () => {
  const { store: s } = store([{ result: { status: 'approved' } }]);
  await expect(s.reserve({ goalId, operationId }, proof)).rejects.toThrow();
});

it('sends the provider balance only with the dispatch claim', async () => {
  const { execute, store: s } = store([{ result: true }]);
  expect(await s.claimDispatch(operationId, 250000)).toBe(true);
  expect(execute).toHaveBeenLastCalledWith(sql.manage, [
    scopeText,
    operationId,
    'dispatch',
    '250000',
  ]);
  await s.cancelBeforeDispatch(operationId);
  expect(execute).toHaveBeenLastCalledWith(sql.manage, [
    scopeText,
    operationId,
    'cancel',
    '0',
  ]);
  await s.cancelStaleReservation(operationId);
  expect(execute).toHaveBeenLastCalledWith(sql.manage, [
    scopeText,
    operationId,
    'cancel_stale',
    '0',
  ]);
  await s.releaseAfterRejection(operationId);
  expect(execute).toHaveBeenLastCalledWith(sql.manage, [
    scopeText,
    operationId,
    'release',
    '0',
  ]);
});

it('refuses a dispatch amount outside the ledger range', async () => {
  const { execute, store: s } = store([{ result: true }]);
  await expect(s.claimDispatch(operationId, 0)).rejects.toThrow();
  await expect(s.claimDispatch(operationId, 10000000000)).rejects.toThrow();
  await expect(s.claimDispatch(operationId, 1.5)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it('reads the attempt state, null when unknown', async () => {
  expect(
    await store([{ result: null }]).store.readStatus(operationId)
  ).toBeNull();
  expect(
    await store([{ result: 'dispatched' }]).store.readStatus(operationId)
  ).toBe('dispatched');
});

it('asks the fixed statement whether an operation id is live for the goal', async () => {
  const { execute, store: s } = store([{ result: true }]);
  expect(await s.isLiveIssued(goalId, operationId)).toBe(true);
  expect(execute).toHaveBeenCalledWith(sql.checkIssued, [
    scopeText,
    goalId,
    operationId,
  ]);
});

it('refuses a malformed operation id before any statement runs', async () => {
  const { execute, store: s } = store([{ result: true }]);
  await expect(s.isLiveIssued(goalId, 'not-a-uuid')).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
