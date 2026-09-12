import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRouteProof,
  requireQuizCsrf,
  requireQuizUser,
} from '@/app/api/quiz/_shared/route-helpers';
import { postQuizAnswerV2 } from './v2-route';

vi.mock('@/app/api/quiz/_shared/route-helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/api/quiz/_shared/route-helpers')
  >('@/app/api/quiz/_shared/route-helpers');
  return {
    ...actual,
    createRouteProof: vi.fn(),
    requireQuizCsrf: vi.fn(),
    requireQuizUser: vi.fn(),
  };
});

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const pending = {
  attemptId: ATTEMPT_ID,
  eventEndsAt: '2026-08-05T10:05:00.000Z',
  eventId: '44444444-4444-4444-8444-444444444444',
  resultsAvailableAt: '2026-08-05T10:05:00.000Z',
  serverNow: '2026-08-05T10:05:00.000Z',
  status: 'submitted_pending_results',
};

function request(body: unknown) {
  return new NextRequest(
    `https://shop.test/api/quiz/attempts/${ATTEMPT_ID}/answers`,
    {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'X-Baci-Quiz-Contract': '2',
      },
      method: 'POST',
    }
  );
}

function context(attemptId = ATTEMPT_ID) {
  return { params: Promise.resolve({ attemptId }) };
}

function authenticated(
  answerResult: { data: unknown; error: unknown } = {
    data: pending,
    error: null,
  }
) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'quiz_runtime_contract_version'
        ? { data: 2, error: null }
        : name === 'get_quiz_attempt_submission_time_v2'
          ? { data: '2026-08-05T10:04:12.345Z', error: null }
          : answerResult
    )
  );
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod: 'bearer',
    response: null,
    supabase: { rpc },
    user: { id: USER_ID },
  } as never);
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireQuizCsrf).mockResolvedValue(null);
  vi.mocked(createRouteProof).mockReturnValue({
    proof: { proof_id: 'proof' },
    response: null,
  } as never);
});

describe('v2 quiz answer route', () => {
  it('authenticates and checks CSRF before parsing or mutating', async () => {
    vi.mocked(requireQuizUser).mockResolvedValue({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as never);
    expect((await postQuizAnswerV2(request({}), context())).status).toBe(401);
    expect(requireQuizCsrf).not.toHaveBeenCalled();

    authenticated();
    vi.mocked(requireQuizCsrf).mockResolvedValue(
      NextResponse.json({ error: 'CSRF' }, { status: 403 })
    );
    expect((await postQuizAnswerV2(request({}), context())).status).toBe(403);
  });

  it('validates route and body without legacy timing fields', async () => {
    const rpc = authenticated();
    expect(
      (
        await postQuizAnswerV2(
          request({ answer: 'A', questionId: QUESTION_ID }),
          context('bad')
        )
      ).status
    ).toBe(400);
    expect(
      (
        await postQuizAnswerV2(
          request({
            answer: 'A',
            integrityTier: 'device',
            questionId: QUESTION_ID,
          }),
          context()
        )
      ).status
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('submits the exact v2 action and returns no score or claim', async () => {
    const rpc = authenticated();
    const response = await postQuizAnswerV2(
      request({ answer: 'A', questionId: QUESTION_ID }),
      context()
    );
    expect(response.status).toBe(200);
    expect(createRouteProof).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'submit_quiz_answer_v2',
        subjectId: `${ATTEMPT_ID}:${QUESTION_ID}`,
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(2, 'submit_quiz_answer_v2', {
      p_answer: 'A',
      p_attempt_id: ATTEMPT_ID,
      p_client_answered_at: undefined,
      p_question_id: QUESTION_ID,
      p_route_proof: { proof_id: 'proof' },
      p_user_id: USER_ID,
    });
    expect(await response.json()).toEqual({
      ...pending,
      submittedAt: '2026-08-05T10:04:12.345Z',
    });
  });

  it('maps owner-safe RPC errors without leaking internal details', async () => {
    authenticated({ data: null, error: { code: 'XX', message: 'secret' } });
    const response = await postQuizAnswerV2(
      request({ answer: 'A', questionId: QUESTION_ID }),
      context()
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Quiz request failed' });
  });
});
