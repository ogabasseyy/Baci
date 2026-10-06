import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';

const mockFetch = jest.fn<FetchImplementation>();
global.fetch = mockFetch;
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'token' } },
      })),
      getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
  },
}));

const { recoverActiveQuizAttempt } =
  require('./quiz-attempt-recovery') as typeof import('./quiz-attempt-recovery');

describe('recoverActiveQuizAttempt', () => {
  it('uses owner-safe event lookup and keeps the fingerprint out of the URL', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          availability: 'pending_results',
          eventEndsAt: '2026-08-04T12:05:00.000Z',
          serverNow: '2026-08-04T12:05:01.000Z',
        }),
        { status: 200 }
      )
    );
    await recoverActiveQuizAttempt({
      baseUrl: 'https://example.com',
      deviceFingerprint: 'a'.repeat(64),
      eventId: 'event/1',
      expectedUserId: 'user-1',
    });
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://example.com/api/quiz/attempts/active?eventId=event%2F1'
    );
    expect(String(url)).not.toContain('a'.repeat(64));
    expect(
      new Headers(init?.headers).get('X-Baci-Quiz-Device-Fingerprint')
    ).toBe('a'.repeat(64));
    expect(new Headers(init?.headers).get('X-Baci-Quiz-Contract')).toBe('2');
  });
});
