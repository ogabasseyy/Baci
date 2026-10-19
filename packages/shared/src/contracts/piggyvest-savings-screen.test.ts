import { expect, it } from 'vitest';
import { piggyvestSavingsScreenSchema as schema } from './piggyvest-savings-screen';

it('accepts a clean ready projection and rejects nested additions and invalid money', () => {
  const goalId = '10000000-0000-4000-8000-000000000001';
  const source = {
    environment: 'staging',
    status: 'ready',
    sessionKey: 'synthetic-session',
    goalId,
    policy: {
      status: 'draft',
      goalId,
      revisionId: '20000000-0000-4000-8000-000000000001',
      device: { productName: 'Synthetic', variant: null, condition: 'New' },
      terms: {
        version: 'synthetic-v1',
        hash: 'a'.repeat(64),
        text: 'Synthetic terms only.',
      },
      consent: 'required',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'pending' },
    progress: {
      status: 'ready',
      decision: {
        purchasingPowerKobo: 0,
        devicePriceKobo: 100,
        readiness: 'continue_saving',
        purchaseAction: 'blocked',
      },
      pendingInterestKobo: null,
    },
  };
  expect(schema.parse(source)).toEqual(source);
  for (const invalid of [
    { ...source, eligibility: { ...source.eligibility, granted: true } },
    { ...source, funding: { ...source.funding, accounts: [] } },
    {
      ...source,
      progress: { ...source.progress, onReviewPurchase: () => undefined },
    },
    { ...source, progress: { ...source.progress, pendingInterestKobo: -1 } },
    {
      ...source,
      progress: {
        ...source.progress,
        decision: { ...source.progress.decision, purchasingPowerKobo: 0.1 },
      },
    },
  ])
    expect(schema.safeParse(invalid).success).toBe(false);
});

it.each([
  'loading',
  'unavailable',
  'unauthenticated',
])('accepts only clean staging %s projections', (status) => {
  const source = { environment: 'staging', status };
  expect(schema.parse(source)).toEqual(source);
  expect(schema.safeParse({ ...source, accounts: [] }).success).toBe(false);
  expect(
    schema.safeParse({ ...source, environment: 'production' }).success
  ).toBe(false);
});

it.each([
  null,
  undefined,
  {},
  { status: 'ready' },
  { environment: 'staging', status: 'ready', eligibility: null },
])('rejects malformed DTOs without throwing from safeParse', (value) => {
  expect(schema.safeParse(value).success).toBe(false);
});
