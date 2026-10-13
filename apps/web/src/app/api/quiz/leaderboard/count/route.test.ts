import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireQuizUser } from '@/app/api/quiz/_shared/route-auth';

vi.mock('@/app/api/quiz/_shared/route-auth', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/api/quiz/_shared/route-auth')>();
  return { ...actual, requireQuizUser: vi.fn() };
});

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function request(eventId = EVENT_ID) {
  return new NextRequest(
    `https://shop.test/api/quiz/leaderboard/count?eventId=${eventId}`
  );
}

function authenticate(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod: 'cookie',
    response: null,
    supabase: { rpc } as never,
    user: { id: 'user-1' } as never,
  });
  return rpc;
}

describe('quiz participant count route', () => {
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
    const rpc = authenticate(1);
    const { GET } = await import('./route');

    expect((await GET(request('bad'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the projected participant count', async () => {
    const rpc = authenticate(42);
    const { GET } = await import('./route');
    const response = await GET(request());

    expect(rpc).toHaveBeenCalledWith('get_quiz_participant_count_public_v2', {
      p_event_id: EVENT_ID,
    });
    expect(await response.json()).toEqual({ participantCount: 42 });
  });

  it('rejects malformed count projections', async () => {
    authenticate(-1);
    const { GET } = await import('./route');

    expect((await GET(request())).status).toBe(500);
  });
});
