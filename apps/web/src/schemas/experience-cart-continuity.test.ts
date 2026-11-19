import { expect, it } from 'vitest';
import { experienceCartContinuitySchema } from './experience-cart-continuity';

it('exposes only a bounded opaque fingerprint, never principal or customer details', () => {
  expect(
    experienceCartContinuitySchema.safeParse({ fingerprint: 'a'.repeat(64) })
      .success
  ).toBe(true);
  expect(
    experienceCartContinuitySchema.safeParse({
      fingerprint: 'a'.repeat(64),
      customerId: 'private',
    }).success
  ).toBe(false);
  expect(
    experienceCartContinuitySchema.safeParse({ fingerprint: 'forged' }).success
  ).toBe(false);
});
