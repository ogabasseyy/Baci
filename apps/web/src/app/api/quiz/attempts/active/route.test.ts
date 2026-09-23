import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireQuizUser } from '@/app/api/quiz/_shared/route-auth';
import { resolveQuizDevice } from '@/lib/quiz/quiz-device-hash';
import { GET } from './route';

vi.mock('@/app/api/quiz/_shared/route-auth', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/api/quiz/_shared/route-auth')
  >('@/app/api/quiz/_shared/route-auth');
  return { ...actual, requireQuizUser: vi.fn() };
});
vi.mock('@/lib/quiz/quiz-device-hash', () => ({
  resolveQuizDevice: vi.fn(),
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const FINGERPRINT = 'a'.repeat(64);

function request(eventId = EVENT_ID) {
  return new NextRequest(
    `https://shop.test/api/quiz/attempts/active?eventId=${eventId}`,
    {
      headers: {
        'X-Baci-Quiz-Contract': '2',
        'X-Baci-Quiz-Device-Fingerprint': FINGERPRINT,
      },
    }
  );
}

function authenticated(
  resumeData: unknown = {
    availability: 'none',
    eventEndsAt: '2026-08-05T10:05:00.000Z',
    serverNow: '2026-08-05T10:00:00.000Z',
  }
) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'quiz_runtime_contract_version'
        ? { data: 2, error: null }
        : { data: resumeData, error: null }
    )
  );
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod: 'bearer',
    response: null,
    supabase: { rpc },
    user: { id: 'user-1' },
  } as never);
  vi.mocked(resolveQuizDevice).mockReturnValue({ deviceHash: 'b'.repeat(64) });
  return rpc;
}

beforeEach(() => vi.clearAllMocks());

describe('active v2 quiz attempt route', () => {
  it('authenticates before validation or resume', async () => {
    vi.mocked(requireQuizUser).mockResolvedValue({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as never);
    expect((await GET(request('bad'))).status).toBe(401);
  });

  it('calls only owner-safe resume and keeps the fingerprint out of query/RPC', async () => {
    const rpc = authenticated();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('resume_quiz_attempt_v2', {
      p_device_hash: 'b'.repeat(64),
      p_event_id: EVENT_ID,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(FINGERPRINT);
  });

  it('rejects malformed selectors before resume', async () => {
    const rpc = authenticated();
    expect((await GET(request('bad'))).status).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(0);
  });

  it('returns the authoritative time for a pending response with a top-level attempt ID', async () => {
    const rpc = authenticated({
      availability: 'pending_results',
      attemptId: ATTEMPT_ID,
      eventEndsAt: '2026-08-05T10:05:00.000Z',
      serverNow: '2026-08-05T10:04:00.000Z',
    });
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'quiz_runtime_contract_version'
          ? { data: 2, error: null }
          : name === 'get_quiz_attempt_submission_time_v2'
            ? { data: '2026-08-05T10:03:12.345Z', error: null }
            : {
                data: {
                  availability: 'pending_results',
                  attemptId: ATTEMPT_ID,
                  eventEndsAt: '2026-08-05T10:05:00.000Z',
                  serverNow: '2026-08-05T10:04:00.000Z',
                },
                error: null,
              }
      )
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      attemptId: ATTEMPT_ID,
      availability: 'pending_results',
      submittedAt: '2026-08-05T10:03:12.345Z',
    });
  });
});
