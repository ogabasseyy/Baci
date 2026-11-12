import { describe, expect, it, vi } from 'vitest';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as forfeitSql } from './goal-cancel-forfeit-statements';
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
const operationId = '66666666-6666-4666-8666-666666666666';
const forfeitId = '77777777-7777-4777-8777-777777777777';
const goalId = '55555555-5555-4555-8555-555555555555';

function store(rows: unknown) {
  const execute = vi.fn().mockResolvedValue({ rows });
  return { execute, store: createGoalCancelStore({ scope, execute }) };
}

describe('split dispatch', () => {
  it('sends the provider balance and returns the database split', async () => {
    const split = {
      status: 'dispatched',
      principalKobo: 250000,
      forfeitedInterestKobo: 12000,
    };
    const { execute, store: s } = store([{ result: split }]);
    expect(await s.splitDispatch(operationId, 262000)).toEqual(split);
    expect(execute).toHaveBeenCalledWith(sql.splitDispatch, [
      scopeText,
      operationId,
      '262000',
    ]);
  });

  it.each([
    'not_claimed',
    'needs_review',
    'forfeit_unavailable',
  ])('passes a %s refusal through', async (status) => {
    const { store: s } = store([{ result: { status } }]);
    expect(await s.splitDispatch(operationId, 1)).toEqual({ status });
  });

  it('refuses an answer the split never gives', async () => {
    const { store: s } = store([
      {
        result: {
          status: 'dispatched',
          principalKobo: -1,
          forfeitedInterestKobo: 0,
        },
      },
    ]);
    await expect(s.splitDispatch(operationId, 1)).rejects.toThrow();
  });

  it('refuses a balance outside the ledger range before any statement runs', async () => {
    const { execute, store: s } = store([]);
    await expect(s.splitDispatch(operationId, 0)).rejects.toThrow();
    await expect(
      s.splitDispatch(operationId, 10_000_000_000)
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('cancel amounts', () => {
  it('reads what goes back and what is forfeited', async () => {
    const amounts = { principalKobo: 250000, forfeitedInterestKobo: 12000 };
    const { execute, store: s } = store([{ result: amounts }]);
    expect(await s.readAmounts(operationId)).toEqual(amounts);
    expect(execute).toHaveBeenCalledWith(sql.amounts, [scopeText, operationId]);
  });

  it('reads null before dispatch', async () => {
    const { store: s } = store([{ result: null }]);
    expect(await s.readAmounts(operationId)).toBeNull();
  });
});

describe('forfeit leg', () => {
  it('claims the forfeit transfer through the fixed statement', async () => {
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
    const { execute, store: s } = store([
      { result: { status: 'claimed', forfeit } },
    ]);
    expect(await s.claimForfeit(operationId)).toEqual({
      status: 'claimed',
      forfeit,
    });
    expect(execute).toHaveBeenCalledWith(forfeitSql.claim, [
      scopeText,
      operationId,
    ]);
  });

  it.each([
    { status: 'pending', forfeitId },
    { status: 'waiting' },
    { status: 'confirmed' },
    { status: 'needs_review' },
    { status: 'none' },
    { status: 'unavailable' },
  ])('passes %j through', async (result) => {
    const { store: s } = store([{ result }]);
    expect(await s.claimForfeit(operationId)).toEqual(result);
  });

  it('releases a rejected forfeit through the fixed statement', async () => {
    const { execute, store: s } = store([{ result: true }]);
    expect(await s.releaseForfeit(forfeitId)).toBe(true);
    expect(execute).toHaveBeenCalledWith(forfeitSql.manage, [
      scopeText,
      forfeitId,
      'release',
    ]);
  });
});
