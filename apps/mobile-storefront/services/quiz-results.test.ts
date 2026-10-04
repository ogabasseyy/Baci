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
const { fetchQuizResult } =
  require('./quiz-results') as typeof import('./quiz-results');

describe('fetchQuizResult', () => {
  it('parses pending and published results without deriving claims from answers', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attemptId: 'attempt-1',
            availability: 'pending',
            availableAt: null,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attemptId: 'attempt-1',
            availability: 'final',
            availableAt: '2026-08-04T12:06:00.000Z',
            claim: {
              expiresAt: '2026-08-05T12:06:00.000Z',
              token: 'signed-claim',
            },
            rank: 1,
            score: 20,
            totalQuestions: 20,
          }),
          { status: 200 }
        )
      );
    await expect(
      fetchQuizResult({ attemptId: 'attempt-1', expectedUserId: 'user-1' })
    ).resolves.toMatchObject({ availability: 'pending' });
    await expect(
      fetchQuizResult({ attemptId: 'attempt-1', expectedUserId: 'user-1' })
    ).resolves.toMatchObject({
      availability: 'final',
      rank: 1,
      claim: { token: 'signed-claim' },
    });
  });

  it('accepts a test result with no claim', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          attemptId: 'attempt-test',
          availability: 'final',
          availableAt: '2026-08-04T12:06:00.000Z',
          rank: 2,
          score: 19,
          totalQuestions: 20,
        }),
        { status: 200 }
      )
    );
    const result = await fetchQuizResult({
      attemptId: 'attempt-test',
      expectedUserId: 'user-1',
    });
    expect(result).not.toHaveProperty('claim');
  });
});
