import { describe, expect, it } from 'vitest';
import { quizAttestationModeEnvSchema } from './quiz-attestation-env-schema';

describe('quizAttestationModeEnvSchema', () => {
  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['  ', 'off'],
    [' enforce ', 'enforce'],
    ['monitor', 'monitor'],
  ])('maps %j to %s', (input, expected) => {
    expect(quizAttestationModeEnvSchema.parse(input)).toBe(expected);
  });
  it('rejects an unknown mode', () => {
    expect(quizAttestationModeEnvSchema.safeParse('maybe').success).toBe(false);
  });
});
