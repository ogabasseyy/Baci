import { describe, expect, it } from 'vitest';
import { verificationSecretCandidates } from './session-proof-candidates';

const CURRENT = 'current-secret-that-is-at-least-32-chars';
const RETIRED = 'retired-secret-that-is-at-least-32-chars';
const retireAt = new Date(1_800_000_000_000).toISOString();

function candidates(
  overrides: Partial<Parameters<typeof verificationSecretCandidates>[0]> = {}
) {
  return verificationSecretCandidates({
    currentSecret: CURRENT,
    issuedAt: 1_799_999_000,
    previousSecrets: [{ retireAt, secret: RETIRED }],
    sessionProofTtlSeconds: 3600,
    verifyNow: 1_800_000_500,
    ...overrides,
  });
}

describe('verificationSecretCandidates', () => {
  it('returns the current secret first, then still-valid retired secrets', () => {
    expect(candidates()).toEqual([CURRENT, RETIRED]);
  });

  it('excludes a retired secret for proofs issued after its retirement', () => {
    expect(candidates({ issuedAt: 1_800_000_001 })).toEqual([CURRENT]);
  });

  it('excludes a retired secret once one proof lifetime past retirement elapsed', () => {
    expect(candidates({ verifyNow: 1_800_003_601 })).toEqual([CURRENT]);
  });

  it('rejects backdated proofs after the short rotation grace window', () => {
    // TTL is a week, but retired acceptance closes 24 hours after
    // retirement even for proofs claiming pre-retirement issuance.
    expect(
      candidates({
        sessionProofTtlSeconds: 7 * 24 * 3600,
        verifyNow: 1_800_000_000 + 24 * 3600 + 1,
      })
    ).toEqual([CURRENT]);
    expect(
      candidates({
        sessionProofTtlSeconds: 7 * 24 * 3600,
        verifyNow: 1_800_000_000 + 3600,
      })
    ).toEqual([CURRENT, RETIRED]);
  });

  it('excludes short or unparseable retired secrets', () => {
    expect(
      candidates({ previousSecrets: [{ retireAt, secret: 'short' }] })
    ).toEqual([CURRENT]);
    expect(
      candidates({ previousSecrets: [{ retireAt: 'never', secret: RETIRED }] })
    ).toEqual([CURRENT]);
  });

  it('excludes a short current secret', () => {
    expect(candidates({ currentSecret: 'short' })).toEqual([RETIRED]);
  });
});
