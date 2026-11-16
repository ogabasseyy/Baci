import { describe, expect, it } from 'vitest';
import {
  quizAttestationChallengeRequestSchema,
  quizAttestationChallengeResponseSchema,
} from './quiz-schema-attestation';

describe('quiz attestation schemas', () => {
  it('accepts a uuid event id and rejects extras or non-uuids', () => {
    const id = '3f2b1c0e-8f3a-4c55-9d52-0a1b2c3d4e5f';
    expect(
      quizAttestationChallengeRequestSchema.safeParse({ eventId: id }).success
    ).toBe(true);
    expect(
      quizAttestationChallengeRequestSchema.safeParse({ eventId: 'x' }).success
    ).toBe(false);
    expect(
      quizAttestationChallengeRequestSchema.safeParse({ eventId: id, a: 1 })
        .success
    ).toBe(false);
  });
  it('requires a 43-char url-safe nonce in the response', () => {
    expect(
      quizAttestationChallengeResponseSchema.safeParse({
        expiresAt: 'x',
        nonce: 'a'.repeat(43),
      }).success
    ).toBe(true);
    expect(
      quizAttestationChallengeResponseSchema.safeParse({
        expiresAt: 'x',
        nonce: 'short',
      }).success
    ).toBe(false);
  });
});
