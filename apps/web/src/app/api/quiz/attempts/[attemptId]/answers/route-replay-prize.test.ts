import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';
const AWARD_ID = '44444444-4444-4444-8444-444444444444';
const AWARD_CLAIM_EXPIRES_AT = '2030-07-15T10:00:00.000Z';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORIGINAL_QUIZ_RPC_SERVER_SECRET = process.env.QUIZ_RPC_SERVER_SECRET;

function jsonRequest(body: unknown) {
  return new NextRequest(
    `http://localhost/api/quiz/attempts/${ATTEMPT_ID}/answers`,
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

function decodeVoucherExpiry(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
  );
  return payload.expiresAt;
}

function mockReplaySupabase({
  attemptResult = { data: null, error: null },
  awardResult = { data: null, error: null },
  rpcError = {
    code: 'QZ004',
    message: 'quiz attempt question is not answerable',
  },
}: {
  attemptResult?: { data: unknown; error: unknown };
  awardResult?: { data: unknown; error: unknown };
  rpcError?: { code: string; message: string };
} = {}) {
  const attemptBuilder = {
    eq: vi.fn(() => attemptBuilder),
    maybeSingle: vi.fn().mockResolvedValue(attemptResult),
    select: vi.fn(() => attemptBuilder),
  };
  const from = vi.fn((table: string) => {
    if (table === 'quiz_attempts') return attemptBuilder;
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'get_quiz_attempt_prize_claim_v2'
        ? awardResult
        : { data: null, error: rpcError }
    )
  );
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from,
    rpc,
  };

  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return { rpc };
}

describe('submit quiz answer replay prize recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QUIZ_RPC_SERVER_SECRET = 'test-secret';
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
  });

  afterEach(() => {
    if (ORIGINAL_QUIZ_RPC_SERVER_SECRET === undefined) {
      delete process.env.QUIZ_RPC_SERVER_SECRET;
      return;
    }
    process.env.QUIZ_RPC_SERVER_SECRET = ORIGINAL_QUIZ_RPC_SERVER_SECRET;
  });

  it('re-issues the signed prize claim when a winning final answer is replayed', async () => {
    const { rpc } = mockReplaySupabase({
      attemptResult: {
        data: {
          status: 'submitted',
          quiz_attempt_questions: [
            { quiz_attempt_answers: [{ score_delta: 1 }] },
          ],
        },
        error: null,
      },
      awardResult: {
        data: {
          claimExpiresAt: AWARD_CLAIM_EXPIRES_AT,
          awardId: AWARD_ID,
          productId: PRODUCT_ID,
          variantId: null,
          condition: null,
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({
        answer: 'A',
        integrityTier: 'strong',
        questionId: QUESTION_ID,
      }),
      { params: Promise.resolve({ attemptId: ATTEMPT_ID }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      attemptId: ATTEMPT_ID,
      correctAnswers: 1,
      prizeEligible: true,
      status: 'completed',
      totalQuestions: 1,
      prizeClaim: {
        awardId: AWARD_ID,
        condition: null,
        productId: PRODUCT_ID,
        variantId: null,
      },
    });
    expect(typeof body.prizeClaim.voucherToken).toBe('string');
    expect(body.prizeClaim.voucherToken.length).toBeGreaterThan(0);
    expect(decodeVoucherExpiry(body.prizeClaim.voucherToken)).toBe(
      AWARD_CLAIM_EXPIRES_AT
    );
    expect(body.prizeClaim.cartPath).toContain(`quiz_award_id=${AWARD_ID}`);
    expect(rpc).toHaveBeenCalledWith('get_quiz_attempt_prize_claim_v2', {
      p_attempt_id: ATTEMPT_ID,
      p_user_id: USER_ID,
    });
  });

  it('reports a practice result with no claim when the attempt has no award', async () => {
    mockReplaySupabase({
      attemptResult: {
        data: {
          status: 'submitted',
          quiz_attempt_questions: [
            { quiz_attempt_answers: [{ score_delta: 0 }] },
          ],
        },
        error: null,
      },
      awardResult: { data: null, error: null },
    });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({
        answer: 'A',
        integrityTier: 'strong',
        questionId: QUESTION_ID,
      }),
      { params: Promise.resolve({ attemptId: ATTEMPT_ID }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      attemptId: ATTEMPT_ID,
      correctAnswers: 0,
      prizeEligible: false,
      status: 'completed',
      totalQuestions: 1,
    });
  });
});
