import { describe, expect, it, vi } from 'vitest';
import {
  isReplayStateError,
  mapSubmittedAttemptScore,
  recoverReplayedAttemptResponse,
} from './submit-answer-helpers';

function createSupabaseForRecoveredAward({
  claimExpiresAt = null,
  createdAt = null,
}: {
  claimExpiresAt?: unknown;
  createdAt?: unknown;
} = {}) {
  const attemptQuery = createQueryResult({
    data: {
      status: 'submitted',
      quiz_attempt_questions: [{ quiz_attempt_answers: [{ score_delta: 1 }] }],
    },
    error: null,
  });
  const awardQuery = createQueryResult({
    data: {
      awardId: '11111111-1111-4111-8111-111111111111',
      claimExpiresAt,
      condition: 'new',
      createdAt,
      productId: '22222222-2222-4222-8222-222222222222',
      variantId: null,
    },
    error: null,
  });

  return {
    from: vi.fn(() => attemptQuery),
    rpc: vi.fn(async (name: string) =>
      name === 'get_quiz_attempt_prize_claim_v2'
        ? awardQuery.maybeSingle()
        : null
    ),
  };
}

function createQueryResult(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    select: vi.fn(() => query),
  };
  return query;
}

describe('isReplayStateError', () => {
  it('recognizes the replay-recoverable RPC codes', () => {
    expect(isReplayStateError({ code: 'QZ004' })).toBe(true);
    expect(isReplayStateError({ code: 'QZ026' })).toBe(true);
    expect(isReplayStateError({ code: 'QZ029' })).toBe(false);
    expect(isReplayStateError(null)).toBe(false);
  });
});

describe('mapSubmittedAttemptScore', () => {
  it('tallies score_delta across submitted questions', () => {
    expect(
      mapSubmittedAttemptScore({
        status: 'submitted',
        quiz_attempt_questions: [
          { quiz_attempt_answers: [{ score_delta: 1 }] },
          { quiz_attempt_answers: [{ score_delta: 0 }] },
        ],
      })
    ).toEqual({ correctAnswers: 1, totalQuestions: 2 });
  });

  it('returns null for non-submitted or empty attempts', () => {
    expect(
      mapSubmittedAttemptScore({
        status: 'started',
        quiz_attempt_questions: [],
      })
    ).toBeNull();
    expect(mapSubmittedAttemptScore(null)).toBeNull();
  });
});

describe('recoverReplayedAttemptResponse', () => {
  it.each([
    { claimExpiresAt: null, createdAt: null },
    { claimExpiresAt: 'not-a-date', createdAt: '2026-08-01T10:00:00.000Z' },
    { claimExpiresAt: null, createdAt: 'not-a-date' },
  ])('fails closed when the recovered award has no usable expiry', async (awardFields) => {
    const response = await recoverReplayedAttemptResponse(
      createSupabaseForRecoveredAward(awardFields) as never,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Quiz request failed',
    });
  });

  it('reissues a legacy award using its created-at TTL when claim expiry is absent', async () => {
    const originalSecret = process.env.QUIZ_RPC_SERVER_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    process.env.QUIZ_RPC_SERVER_SECRET = 'test-secret';
    try {
      const response = await recoverReplayedAttemptResponse(
        createSupabaseForRecoveredAward({
          claimExpiresAt: null,
          createdAt: '2026-08-01T10:00:00.000Z',
        }) as never,
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111'
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.prizeClaim.voucherToken).toEqual(expect.any(String));
      const payload = JSON.parse(
        Buffer.from(
          body.prizeClaim.voucherToken.split('.')[1],
          'base64url'
        ).toString('utf8')
      );
      expect(payload.expiresAt).toBe('2026-08-08T10:00:00.000Z');
    } finally {
      if (originalSecret === undefined)
        delete process.env.QUIZ_RPC_SERVER_SECRET;
      else process.env.QUIZ_RPC_SERVER_SECRET = originalSecret;
      vi.useRealTimers();
    }
  });

  it('does not reissue an expired persisted prize claim on answer replay', async () => {
    const originalSecret = process.env.QUIZ_RPC_SERVER_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
    process.env.QUIZ_RPC_SERVER_SECRET = 'test-secret';
    try {
      const response = await recoverReplayedAttemptResponse(
        createSupabaseForRecoveredAward({
          claimExpiresAt: '2026-08-15T10:00:00.000Z',
          createdAt: '2026-08-08T10:00:00.000Z',
        }) as never,
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111'
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        attemptId: '33333333-3333-4333-8333-333333333333',
        correctAnswers: 1,
        prizeEligible: false,
        status: 'completed',
        totalQuestions: 1,
      });
    } finally {
      if (originalSecret === undefined)
        delete process.env.QUIZ_RPC_SERVER_SECRET;
      else process.env.QUIZ_RPC_SERVER_SECRET = originalSecret;
      vi.useRealTimers();
    }
  });
});
