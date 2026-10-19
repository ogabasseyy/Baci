import { expect, it } from 'vitest';
import { piggyvestGoalLifecycleSchemas as schemas } from './piggyvest-goal-lifecycle';

it('requires canonical bounded dates and explicit consented duration in activation receipts', () => {
  const receipt = {
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lifecycle: 'active',
    activatedAt: '2024-01-31T09:00:00Z',
    guaranteeKobo: 100001,
    collectionPaused: true,
    collectionConsent: 'not_granted',
    evidence: 'local_synthetic_only',
    durationMonths: 1,
    maturesAt: '2024-02-29T09:00:00Z',
    graceExpiresAt: '2024-03-30T09:00:00Z',
  };
  expect(
    schemas.acknowledgement.parse([
      {
        result: { ...receipt, operationId: receipt.operationId.toUpperCase() },
      },
    ])[0].result.operationId
  ).toBe(receipt.operationId);
  for (const change of [
    { durationMonths: undefined },
    { durationMonths: 7 },
    { activatedAt: 'tomorrow' },
    { collectionConsent: 'granted' },
    { guaranteeKobo: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    expect(
      schemas.acknowledgement.safeParse([{ result: { ...receipt, ...change } }])
        .success
    ).toBe(false);
  }
});
