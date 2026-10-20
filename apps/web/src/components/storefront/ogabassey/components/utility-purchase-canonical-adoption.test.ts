import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';
import {
  clearPendingVtuKeys,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { adoptSubmittedCanonicalKey } from './utility-purchase-canonical-adoption';

const attempt: UtilityIdempotencyAttempt = {
  key: 'key-loser',
  scoped: 'scoped-1',
  recalled: false,
};

describe('adoptSubmittedCanonicalKey', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('re-keys the captured attempt when the winner is live', async () => {
    // The mocked adoption stands in for a real rebind (the hook
    // test covers the integration); the live entry holds the
    // winner, so this generation was adopted.
    rememberPendingVtuPurchase('scoped-1', 'key-winner');
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

  it('returns null when a newer generation vetoed the adoption', async () => {
    // Codex R5 P1: the live entry moved to a newer key while this
    // response was in flight — the adoption vetoed. Retagging to
    // the old winner would let scope-based terminal settlement
    // delete the newer key; null settles presentation-only (the
    // newer generation owns the registry now).
    rememberPendingVtuPurchase('scoped-1', 'key-newer');
    const adoptCanonicalKey = vi.fn(async () => true);

    const result = await adoptSubmittedCanonicalKey({
      adoptCanonicalKey,
      attempt,
      canonicalKey: 'key-winner',
    });

    expect(adoptCanonicalKey).toHaveBeenCalled();
    expect(result).toBeNull();
    expect(recallPendingVtuKey('scoped-1')).toBe('key-newer');
  });

  it('returns null when the entry is gone (never resurrect)', async () => {
    // Forgotten/rotated meanwhile: nothing to rebind, and a
    // retag would settle against a dead generation.
    const adoptCanonicalKey = vi.fn(async () => true);

    const result = await adoptSubmittedCanonicalKey({
      adoptCanonicalKey,
      attempt,
      canonicalKey: 'key-winner',
    });

    expect(result).toBeNull();
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
