import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  getBearerTokenFromRequest: () => null,
  hasBearerAuthScheme: () => false,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROW = {
  customer_name: 'captured_handle',
  is_current_customer: false,
  rank: 1,
  score: 5,
  status: 'scored',
  submitted_at: '2026-07-14T09:01:00.000Z',
  total_time_seconds: 30.5,
};

function mockSupabase({
  data = { current_player: null, entries: [ROW], status: 'published' },
  participantCount = 1,
  error = null,
  user = { id: USER_ID },
}: {
  data?: unknown;
  participantCount?: number;
  error?: unknown;
  user?: { id: string } | null;
} = {}) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'get_quiz_participant_count_public_v2'
        ? { data: participantCount, error: null }
        : { data, error }
    )
  );
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    rpc,
  };
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    error: null,
    supabase: supabase as never,
    user: user as never,
  });
  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return { rpc };
}

function request(eventId = EVENT_ID) {
  return new NextRequest(
    `https://shop.test/api/quiz/leaderboard?eventId=${eventId}`
  );
}

describe('quiz leaderboard route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authenticates before validating or querying', async () => {
    const { rpc } = mockSupabase({ user: null });
    const { GET } = await import('./route');

    expect((await GET(request())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid event id', async () => {
    const { rpc } = mockSupabase();
    const { GET } = await import('./route');

    expect((await GET(request('bad'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the top 100 and a rank-101 current player separately', async () => {
    const current = {
      ...ROW,
      customer_name: 'my_snapshot',
      is_current_customer: true,
      rank: '101',
    };
    const { rpc } = mockSupabase({
      data: { current_player: current, entries: [ROW], status: 'published' },
      participantCount: 101,
    });
    const { GET } = await import('./route');
    const response = await GET(request());

    expect(rpc).toHaveBeenCalledWith('get_quiz_leaderboard_public_v2', {
      p_event_id: EVENT_ID,
    });
    expect(rpc).toHaveBeenCalledWith('get_quiz_participant_count_public_v2', {
      p_event_id: EVENT_ID,
    });
    expect(await response.json()).toEqual({
      currentPlayer: {
        displayName: 'my_snapshot',
        isCurrentCustomer: true,
        rank: 101,
        score: 5,
        status: 'scored',
        submittedAt: '2026-07-14T09:01:00.000Z',
        totalTimeSeconds: 30.5,
      },
      entries: [
        {
          displayName: 'captured_handle',
          isCurrentCustomer: false,
          rank: 1,
          score: 5,
          status: 'scored',
          submittedAt: '2026-07-14T09:01:00.000Z',
          totalTimeSeconds: 30.5,
        },
      ],
      participantCount: 101,
      status: 'published',
    });
  });

  it('returns live_hidden with no entries before publication', async () => {
    const { rpc } = mockSupabase({
      data: { current_player: null, entries: [], status: 'live_hidden' },
    });
    const { GET } = await import('./route');
    const body = await (await GET(request())).json();

    expect(body).toEqual({
      currentPlayer: null,
      entries: [],
      participantCount: 1,
      status: 'live_hidden',
    });
    expect(rpc).toHaveBeenCalledWith('get_quiz_live_leaderboard_public_v2', {
      p_event_id: EVENT_ID,
    });
  });

  it('maps authorization failure and hides malformed or failed projections', async () => {
    mockSupabase({
      data: null,
      error: { code: 'QZ031', message: 'not_authorized' },
    });
    const { GET } = await import('./route');
    expect((await GET(request())).status).toBe(403);

    mockSupabase({ data: { entries: [{ customer_id: 'leak' }] } });
    expect((await GET(request())).status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});
