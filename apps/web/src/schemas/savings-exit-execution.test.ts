import { describe, expect, it } from 'vitest';
import { savingsExitExecutionSchemas as schemas } from './savings-exit-execution';

it('accepts only bounded durable accounting acknowledgements', () => {
  const operationId = '30000000-0000-4000-8000-000000004212';
  for (const state of ['accounted', 'pending_projection', 'pending']) {
    expect(
      schemas.accountingRows.safeParse([{ result: { state, operationId } }])
        .success
    ).toBe(true);
  }
  for (const rows of [
    [],
    [{ result: { state: 'settled', operationId } }],
    [{ result: { state: 'accounted', operationId: 'wrong' } }],
  ]) {
    expect(schemas.accountingRows.safeParse(rows).success).toBe(false);
  }
});

const ids = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  actorId: '90000000-0000-4000-8000-000000000001',
  operationId: '80000000-0000-4000-8000-000000000001',
  policyId: '70000000-0000-4000-8000-000000000001',
};

const transfer = {
  action: 'purchase' as const,
  operationId: ids.operationId,
  reference: ids.operationId,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'merchant-wallet',
  amountKobo: 100,
  currency: 'NGN' as const,
};

describe('savings exit execution schemas', () => {
  it('accepts a scoped configuration, command, request, and policy reference', () => {
    expect(
      schemas.configuration.parse({
        integrationId: ids.integrationId.toUpperCase(),
        merchantId: ids.merchantId,
        customerId: ids.customerId,
        goalId: ids.goalId,
        expectedBusinessId: 'synthetic-business',
        actorId: ids.actorId,
      })
    ).toMatchObject({ integrationId: ids.integrationId });
    expect(schemas.command.parse({ operationId: ids.operationId })).toEqual({
      operationId: ids.operationId,
    });
    expect(
      schemas.request.parse({
        goalId: ids.goalId,
        operationId: ids.operationId,
      })
    ).toEqual({
      goalId: ids.goalId,
      operationId: ids.operationId,
    });
    expect(schemas.policy.parse({ policyId: ids.policyId })).toEqual({
      policyId: ids.policyId,
    });
  });

  it('rejects unscoped configuration and self-provisioned policy fields', () => {
    expect(
      schemas.configuration.safeParse({
        ...ids,
        expectedBusinessId: '',
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      schemas.policy.safeParse({
        policyId: ids.policyId,
        sourceWalletId: 'attacker-wallet',
      }).success
    ).toBe(false);
  });

  it('accepts an exact non-zero NGN transfer', () => {
    expect(schemas.transfer.parse(transfer)).toEqual(transfer);
  });

  it('rejects transfer routing, amount, and shape violations', () => {
    expect(
      schemas.transfer.safeParse({
        ...transfer,
        sourceWalletId: 'bad wallet',
        amountKobo: 0,
        providerReceipt: 'untrusted',
      }).success
    ).toBe(false);
  });

  it('accepts exactly one begin row with the prepared transfer', () => {
    expect(
      schemas.beginRows.parse([
        {
          result: {
            state: 'submit',
            operationId: ids.operationId,
            transfer,
          },
        },
      ])
    ).toHaveLength(1);
    expect(
      schemas.beginRows.safeParse([
        { result: { state: 'submit', operationId: ids.operationId } },
        { result: { state: 'verify', operationId: ids.operationId } },
      ]).success
    ).toBe(false);
  });

  it('accepts bounded finality rows and rejects invented terminal states', () => {
    expect(schemas.finality.parse({ ...transfer, status: 'unknown' })).toEqual({
      ...transfer,
      status: 'unknown',
    });
    expect(
      schemas.finalRows.parse([
        { result: { state: 'pending', operationId: ids.operationId } },
      ])
    ).toHaveLength(1);
    expect(
      schemas.finalRows.safeParse([
        { result: { state: 'settled', operationId: ids.operationId } },
      ]).success
    ).toBe(false);
  });
});
