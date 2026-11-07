import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireQuizUser } from '@/app/api/quiz/_shared/route-auth';
import { getQuizEventsV2 } from './v2-route';

vi.mock('@/app/api/quiz/_shared/route-auth', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/api/quiz/_shared/route-auth')
  >('@/app/api/quiz/_shared/route-auth');
  return { ...actual, requireQuizUser: vi.fn() };
});

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

const projection = {
  contractVersion: 2,
  entryMode: 'free',
  events: [
    {
      contractVersion: 2,
      endsAt: '2026-08-05T10:05:00.000Z',
      id: EVENT_ID,
      liveWindowSeconds: 300,
      maxAttempts: 1,
      maximumPlaySeconds: 200,
      mode: 'live',
      prizeName: 'iPhone XR',
      prizeProduct: {
        condition: 'refurbished',
        id: '33333333-3333-4333-8333-333333333333',
        imageUrl: 'https://cdn.test/iphone.jpg',
        name: 'iPhone XR',
        variantId: null,
      },
      questionCount: 20,
      resultsPublishedAt: null,
      rulesVersion: 'rules-v1',
      startsAt: '2026-08-05T10:00:00.000Z',
      status: 'active',
      timePerQuestionSeconds: 10,
      timeZone: 'Africa/Lagos',
      title: 'Redmi Warriors',
    },
  ],
  pagination: { hasMore: false, limit: 20, nextOffset: null, offset: 0 },
  serverNow: '2026-08-05T10:00:01.000Z',
};

function request(extraQuery = '') {
  return new NextRequest(
    `https://shop.test/api/quiz/events?merchantId=${MERCHANT_ID}${extraQuery}`,
    { headers: { 'X-Baci-Quiz-Contract': '2' } }
  );
}

function authenticated(
  listResult: { data: unknown; error: unknown } = {
    data: projection,
    error: null,
  }
) {
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: MERCHANT_ID },
      error: null,
    }),
    select: vi.fn(() => builder),
  };
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'quiz_runtime_contract_version'
        ? { data: 2, error: null }
        : listResult
    )
  );
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod: 'bearer',
    response: null,
    supabase: { from: vi.fn(() => builder), rpc },
    user: { id: 'user-1' },
  } as never);
  return rpc;
}

beforeEach(() => vi.clearAllMocks());

describe('v2 quiz events route', () => {
  it('authenticates before reading query or tenant data', async () => {
    vi.mocked(requireQuizUser).mockResolvedValue({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as never);
    expect((await getQuizEventsV2(request())).status).toBe(401);
  });

  it('returns the strict shared event contract and normalizes entry mode', async () => {
    const rpc = authenticated();
    const response = await getQuizEventsV2(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...projection,
      entryMode: 'free-v1',
    });
    expect(rpc).toHaveBeenLastCalledWith('list_quiz_events_v2', {
      p_limit: 20,
      p_merchant_id: MERCHANT_ID,
      p_offset: 0,
    });
  });

  it('maps a cross-tenant projection refusal without exposing data', async () => {
    authenticated({
      data: null,
      error: { code: 'QZ031', message: 'not_authorized' },
    });
    const response = await getQuizEventsV2(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('permit');
  });

  it('returns only joinable events in one response when current=1', async () => {
    const rpc = authenticated({
      data: {
        ...projection,
        events: [
          projection.events[0],
          {
            ...projection.events[0],
            id: '22222222-2222-4222-8222-000000000009',
            status: 'completed',
          },
        ],
      },
      error: null,
    });

    const response = await getQuizEventsV2(request('&current=1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.map((event: { id: string }) => event.id)).toEqual([
      EVENT_ID,
    ]);
    expect(body.pagination).toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith('list_quiz_events_v2', {
      p_limit: 50,
      p_merchant_id: MERCHANT_ID,
      p_offset: 0,
    });
  });

  it('maps a current-listing refusal like the paged listing', async () => {
    authenticated({
      data: null,
      error: { code: 'QZ031', message: 'not_authorized' },
    });

    const response = await getQuizEventsV2(request('&current=1'));

    expect(response.status).toBe(403);
  });
});
