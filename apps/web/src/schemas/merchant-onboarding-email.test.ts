import { expect, it } from 'vitest';
import {
  onboardingJobSchema,
  onboardingOptOutTokenSchema,
} from './merchant-onboarding-email';

const id = '12345678-1234-4123-8123-123456789abc';
it('accepts an opaque opt-out capability and rejects URL/HTML input', () => {
  expect(onboardingOptOutTokenSchema.safeParse(id).success).toBe(true);
  for (const value of ['<script>', `https://example.com/${id}`, '', null])
    expect(onboardingOptOutTokenSchema.safeParse(value).success).toBe(false);
});
it('rejects unknown stages and malformed queue identities before dispatch', () => {
  const job = { id, merchant_id: id, stage: 'welcome', claim_token: id };
  expect(onboardingJobSchema.safeParse(job).success).toBe(true);
  expect(
    onboardingJobSchema.safeParse({ ...job, stage: 'promotional-winback' })
      .success
  ).toBe(false);
  expect(
    onboardingJobSchema.safeParse({ ...job, claim_token: null }).success
  ).toBe(false);
});
