import { quizAttestationChallengeResponseSchema } from './quiz-attestation-schemas';

describe('quizAttestationChallengeResponseSchema', () => {
  it('accepts a challenge with a nonce and expiry', () => {
    expect(
      quizAttestationChallengeResponseSchema.safeParse({
        expiresAt: '2026-11-16T10:00:00Z',
        nonce: 'abc',
      }).success
    ).toBe(true);
  });
  it('rejects an empty nonce or a missing expiry', () => {
    expect(
      quizAttestationChallengeResponseSchema.safeParse({
        expiresAt: 'x',
        nonce: '',
      }).success
    ).toBe(false);
    expect(
      quizAttestationChallengeResponseSchema.safeParse({ nonce: 'abc' }).success
    ).toBe(false);
  });
});
