import { describe, expect, it } from 'vitest';
import { checkBuilderAiRateLimit } from './builder-ai-rate-limit';

describe('checkBuilderAiRateLimit', () => {
  it('rejects the eleventh request within a builder window and resets afterward', () => {
    const identifier = 'builder:test-rate-limit';
    const startedAt = 1_000;

    for (let request = 0; request < 10; request += 1) {
      expect(checkBuilderAiRateLimit(identifier, startedAt).allowed).toBe(true);
    }
    expect(checkBuilderAiRateLimit(identifier, startedAt)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(
      checkBuilderAiRateLimit(identifier, startedAt + 60_000)
    ).toMatchObject({
      allowed: true,
      remaining: 9,
    });
  });
});
