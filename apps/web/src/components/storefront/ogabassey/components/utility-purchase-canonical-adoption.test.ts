import { describe, expect, it, vi } from 'vitest';
import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';
import { adoptSubmittedCanonicalKey } from './utility-purchase-canonical-adoption';

const attempt: UtilityIdempotencyAttempt = {
  key: 'key-loser',
  scoped: 'scoped-1',
  recalled: false,
};

describe('adoptSubmittedCanonicalKey', () => {
  it('re-keys the captured attempt to the winner after a claim join', async () => {
    const adoptCanonicalKey = vi.fn(async () => true);

    const result = await adoptSubmittedCanonicalKey({
      adoptCanonicalKey,
      attempt,
      canonicalKey: 'key-winner',
    });

    expect(adoptCanonicalKey).toHaveBeenCalledWith(
      'scoped-1',
      'key-loser',
      'key-winner'
    );
    expect(result).toEqual({ ...attempt, key: 'key-winner' });
    // The caller's object is untouched — retries read the returned copy.
    expect(attempt.key).toBe('key-loser');
  });

  it('leaves the attempt alone when the route reports no canonical key', async () => {
    const adoptCanonicalKey = vi.fn(async () => true);

    const result = await adoptSubmittedCanonicalKey({
      adoptCanonicalKey,
      attempt,
      canonicalKey: undefined,
    });

    expect(adoptCanonicalKey).not.toHaveBeenCalled();
    expect(result).toBe(attempt);
  });

  it('passes a missing attempt through without adopting', async () => {
    const adoptCanonicalKey = vi.fn(async () => true);

    const result = await adoptSubmittedCanonicalKey({
      adoptCanonicalKey,
      attempt: null,
      canonicalKey: 'key-winner',
    });

    expect(adoptCanonicalKey).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
