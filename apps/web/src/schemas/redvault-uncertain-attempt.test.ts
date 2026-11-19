import { expect, it } from 'vitest';
import { redvaultUncertainAttemptSchema } from './redvault-uncertain-attempt';

it('accepts a bounded attempt and rejects invalid identity or fingerprint', () => {
  const attempt = {
    version: 1,
    merchantId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'attempt-key',
    fingerprint: 'uba_redvault:review',
    customer: { email: 'ada@example.test', name: 'Ada', phone: '08012345678' },
    billingAddress: { line1: 'Pickup at Store', city: 'Lagos', country: 'NG' },
    orderRequest: {},
    createdAt: 1,
  };
  expect(redvaultUncertainAttemptSchema.safeParse(attempt).success).toBe(true);
  expect(
    redvaultUncertainAttemptSchema.safeParse({ ...attempt, merchantId: 'bad' })
      .success
  ).toBe(false);
  expect(
    redvaultUncertainAttemptSchema.safeParse({ ...attempt, fingerprint: 'bad' })
      .success
  ).toBe(false);
});
