import { expect, it } from 'vitest';
import {
  experienceLaunchRenewalSchema,
  experiencePublicRequestSchema,
} from './experience-public-request';

it('accepts only the public digest/path request and bounded renewal response', () => {
  const request = { buildDigest: 'a'.repeat(64), path: '/' };
  expect(experiencePublicRequestSchema.safeParse(request).success).toBe(true);
  expect(
    experiencePublicRequestSchema.safeParse({ ...request, merchantId: 'other' })
      .success
  ).toBe(false);
  expect(
    experienceLaunchRenewalSchema.safeParse({
      ...request,
      policyRevision: 'p',
      catalogRevision: 'r',
      expiresAt: -1,
    }).success
  ).toBe(false);
});
