import { describe, expect, it } from 'vitest';
import { mobileSignupAttemptIdSchema } from './mobile-signup-attempt-id';

describe('mobileSignupAttemptIdSchema', () => {
  it('accepts an opaque UUID', () => {
    expect(
      mobileSignupAttemptIdSchema.safeParse(
        '123e4567-e89b-42d3-a456-426614174000'
      ).success
    ).toBe(true);
  });

  it.each([
    'user-1',
    'owner@example.com',
    'Bearer secret',
  ])('rejects non-UUID monitoring input %s', (value) => {
    expect(mobileSignupAttemptIdSchema.safeParse(value).success).toBe(false);
  });
});
