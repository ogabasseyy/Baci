import { describe, expect, it } from 'vitest';
import { replayAccrualSigningSecretSchema } from './replay-accrual';

describe('restricted interest accrual verification credential', () => {
  it('accepts the explicit server-only signing credential without normalization', () => {
    expect(
      replayAccrualSigningSecretSchema.parse('synthetic-signing-secret')
    ).toBe('synthetic-signing-secret');
  });

  it.each([
    undefined,
    null,
    '',
    'short',
    's'.repeat(1025),
    123,
  ])('rejects missing and malformed credentials', (secret) => {
    expect(replayAccrualSigningSecretSchema.safeParse(secret).success).toBe(
      false
    );
  });
});
