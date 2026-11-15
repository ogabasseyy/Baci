import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requireQuizCsrf,
  requireQuizUser,
} from '@/app/api/quiz/_shared/route-helpers';
import { issueQuizAttestationChallenge } from '@/lib/quiz/quiz-attestation-challenge';
import { POST } from './route';

vi.mock('@/app/api/quiz/_shared/route-helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/api/quiz/_shared/route-helpers')
  >('@/app/api/quiz/_shared/route-helpers');
  return { ...actual, requireQuizCsrf: vi.fn(), requireQuizUser: vi.fn() };
});
vi.mock('@/lib/quiz/quiz-attestation-challenge', () => ({
  issueQuizAttestationChallenge: vi.fn(),
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function request(body: unknown) {
  return new NextRequest('https://shop.test/api/quiz/attestation/challenge', {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'X-Baci-Quiz-Contract': '2',
    },
    method: 'POST',
  });
}

function signedIn(authMethod: 'bearer' | 'cookie') {
  vi.mocked(requireQuizUser).mockResolvedValue({
    authMethod,
    response: null,
    supabase: {} as never,
    user: { id: 'u1' } as never,
  });
  vi.mocked(requireQuizCsrf).mockResolvedValue(null);
}

describe('quiz attestation challenge route', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 when not signed in', async () => {
    vi.mocked(requireQuizUser).mockResolvedValue({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      supabase: null,
      user: null,
    });
    expect((await POST(request({ eventId: EVENT_ID }))).status).toBe(401);
  });
  it('refuses browser (cookie) sessions', async () => {
    signedIn('cookie');
    const res = await POST(request({ eventId: EVENT_ID }));
    expect(res.status).toBe(403);
    expect(issueQuizAttestationChallenge).not.toHaveBeenCalled();
  });
  it('rejects invalid input', async () => {
    signedIn('bearer');
    expect((await POST(request({ eventId: 'nope' }))).status).toBe(400);
  });
  it('issues a challenge for an app session', async () => {
    signedIn('bearer');
    vi.mocked(issueQuizAttestationChallenge).mockResolvedValue({
      expiresAt: '2026-11-15T10:02:00Z',
      nonce: 'a'.repeat(43),
    });
    const res = await POST(request({ eventId: EVENT_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).nonce).toHaveLength(43);
  });
  it('returns 500 when the challenge cannot be stored', async () => {
    signedIn('bearer');
    vi.mocked(issueQuizAttestationChallenge).mockResolvedValue(null);
    expect((await POST(request({ eventId: EVENT_ID }))).status).toBe(500);
  });
});
