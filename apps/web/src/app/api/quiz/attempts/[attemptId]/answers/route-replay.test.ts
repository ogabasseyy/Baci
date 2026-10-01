import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';
// A real auth UUID is required because a winning replay signs a voucher token,
// whose payload schema validates `userId` as a UUID.
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

function mockReplaySupabase({
  attemptResult = { data: null, error: null },
  rpcError = {
    code: 'QZ004',
    message: 'quiz attempt question is not answerable',
  },
  user = { id: USER_ID },
}: {
  attemptResult?: { data: unknown; error: unknown };
  rpcError?: { code: string; message: string };
  user?: { id: string } | null;
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
        ? { data: null, error: null }
        : { data: null, error: rpcError }
    )
  );
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from,
    rpc,
  };

  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return { attemptBuilder, rpc };
}

describe('submit quiz answer replay recovery', () => {
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

  it('returns 401 before replay recovery when authentication is missing', async () => {
    const { rpc } = mockReplaySupabase({ user: null });

    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest({
        answer: 'A',
        integrityTier: 'strong',
        questionId: QUESTION_ID,
      }),
      { params: Promise.resolve({ attemptId: ATTEMPT_ID }) }
    );

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns 400 before replay recovery when the body is invalid', async () => {
    const { rpc } = mockReplaySupabase();

    const { POST } = await import('./route');
    const response = await POST(jsonRequest({}), {
      params: Promise.resolve({ attemptId: ATTEMPT_ID }),
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('recovers completed results for replayed answer submissions', async () => {
    const { attemptBuilder, rpc } = mockReplaySupabase({
      attemptResult: {
        data: {
          status: 'submitted',
          quiz_attempt_questions: [
            {
              quiz_attempt_answers: [{ score_delta: 1 }],
            },
            {
              quiz_attempt_answers: [{ score_delta: 0 }],
            },
          ],
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
    expect(await response.json()).toEqual({
      attemptId: ATTEMPT_ID,
      correctAnswers: 1,
      prizeEligible: false,
      status: 'completed',
      totalQuestions: 2,
    });
    expect(rpc).toHaveBeenCalledWith(
      'submit_quiz_answer',
      expect.objectContaining({ p_attempt_id: ATTEMPT_ID })
    );
    expect(attemptBuilder.select).toHaveBeenCalledWith(
      'id, status, customers!inner(user_id), quiz_attempt_questions(id, quiz_attempt_answers(score_delta))'
    );
    expect(attemptBuilder.eq).toHaveBeenCalledWith('id', ATTEMPT_ID);
    expect(attemptBuilder.eq).toHaveBeenCalledWith(
      'customers.user_id',
      USER_ID
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('recovers completed results when a duplicate answer insert is replayed', async () => {
    mockReplaySupabase({
      rpcError: {
        code: 'QZ026',
        message: 'quiz_answer_already_recorded',
      },
      attemptResult: {
        data: {
          status: 'submitted',
          quiz_attempt_questions: [
            {
              quiz_attempt_answers: [{ score_delta: 1 }],
            },
            {
              quiz_attempt_answers: [{ score_delta: 1 }],
            },
          ],
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
    expect(await response.json()).toEqual({
      attemptId: ATTEMPT_ID,
      correctAnswers: 2,
      prizeEligible: false,
      status: 'completed',
      totalQuestions: 2,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns a recoverable conflict when replay state cannot be completed', async () => {
    mockReplaySupabase({
      attemptResult: {
        data: {
          status: 'started',
          quiz_attempt_questions: [{ quiz_attempt_answers: [] }],
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

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'quiz_attempt_not_answerable',
      error: 'Quiz answer is no longer accepted for this attempt',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
