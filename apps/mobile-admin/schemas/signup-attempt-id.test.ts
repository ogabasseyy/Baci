import { describe, expect, it } from 'vitest';
import { signupAttemptIdSchema } from './signup-attempt-id';

describe('signupAttemptIdSchema', () => {
  it('accepts a UUID correlation identifier', () => {
    expect(
      signupAttemptIdSchema.safeParse('123e4567-e89b-42d3-a456-426614174000')
        .success
    ).toBe(true);
  });

  it.each([
    'owner@example.com',
    'merchant-1',
    '123e4567-e89b-42d3-a456-426614174000?token=secret',
  ])('rejects unsafe or malformed value %s', (value) => {
    expect(signupAttemptIdSchema.safeParse(value).success).toBe(false);
  });
});
