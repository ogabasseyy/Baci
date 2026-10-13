import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireQuizUser } from '@/app/api/quiz/_shared/route-auth';
import { logger } from '@/lib/logger';

vi.mock('@/app/api/quiz/_shared/route-auth', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/api/quiz/_shared/route-auth')>();
  return { ...actual, requireQuizUser: vi.fn() };
});
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ROW = {
  customer_name: 'quizking',
  is_current_customer: true,
  rank: '1',
  score: 5,
  status: 'scored',
  submitted_at: '2026-07-14T09:00:00.000Z',
  total_time_seconds: 30.5,
};

function request(eventId = EVENT_ID) {
  return new NextRequest(
    `https://shop.test/api/quiz/leaderboard/live?eventId=${eventId}`
  );
}

function authenticate(
  data: unknown,
  error: unknown = null,
  participantCount: unknown = null,
  rpcOverride?: ReturnType<typeof vi.fn>
) {
  const rpc =
    rpcOverride ??
    vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_quiz_participant_count_public_v2'
          ? { data: participantCount, error: null }
          : { data, error }
      )
    );
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod: 'cookie',
    response: null,
    supabase: { rpc } as never,
    user: { id: 'user-1' } as never,
  });
  return rpc;
}

describe('quiz live leaderboard route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authenticates before validating or querying', async () => {
    vi.mocked(requireQuizUser).mockResolvedValue({
      response: new Response(null, { status: 401 }) as never,
      supabase: null,
      user: null,
    });
    const { GET } = await import('./route');

    expect((await GET(request())).status).toBe(401);
  });

  it('rejects an invalid event id without querying', async () => {
    const rpc = authenticate({ current_player: null, entries: [] });
    const { GET } = await import('./route');

    expect((await GET(request('bad'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps the live projection into the public response', async () => {
    const rpc = authenticate(
      {
        current_player: ROW,
        entries: [ROW],
        status: 'live',
      },
      null,
      42
    );
    const { GET } = await import('./route');
    const response = await GET(request());

    expect(rpc).toHaveBeenCalledWith('get_quiz_live_leaderboard_public_v2', {
      p_event_id: EVENT_ID,
    });
    expect(await response.json()).toEqual({
      currentPlayer: {
        displayName: 'quizking',
        isCurrentCustomer: true,
        rank: 1,
        score: 5,
        status: 'scored',
        submittedAt: '2026-07-14T09:00:00.000Z',
        totalTimeSeconds: 30.5,
      },
      entries: [
        {
          displayName: 'quizking',
          isCurrentCustomer: true,
          rank: 1,
          score: 5,
          status: 'scored',
          submittedAt: '2026-07-14T09:00:00.000Z',
          totalTimeSeconds: 30.5,
        },
      ],
      participantCount: 42,
      status: 'live',
    });
  });

  it('returns standings when the optional participant count is slow', async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi.fn((name: string) => {
        if (name === 'get_quiz_participant_count_public_v2') {
          return new Promise<never>(() => undefined);
        }
        return Promise.resolve({
          data: { current_player: ROW, entries: [ROW], status: 'live' },
          error: null,
        });
      });
      authenticate(null, null, null, rpc);
      const { GET } = await import('./route');
      const responsePromise = GET(request());

      await vi.advanceTimersByTimeAsync(150);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect((await response.json()).participantCount).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed live projections without logging projection contents', async () => {
    authenticate({ entries: [{ customer_id: 'private-id' }] });
    const { GET } = await import('./route');

    expect((await GET(request())).status).toBe(500);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
