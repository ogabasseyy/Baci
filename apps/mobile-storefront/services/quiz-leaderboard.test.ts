import { jest } from '@jest/globals';

const mockFetch = jest.fn<typeof fetch>();
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
const { fetchQuizLeaderboard } =
  require('./quiz-leaderboard') as typeof import('./quiz-leaderboard');

describe('fetchQuizLeaderboard', () => {
  it('parses publication state and the current-player row', async () => {
    const currentPlayer = {
      displayName: 'Player One',
      isCurrentCustomer: true,
      rank: 2,
      score: 18,
      status: 'scored',
      submittedAt: '2026-08-04T12:04:00.000Z',
      totalTimeSeconds: 44,
    };
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          currentPlayer,
          entries: [currentPlayer],
          participantCount: 1,
          status: 'published',
        }),
        { status: 200 }
      )
    );
    await expect(
      fetchQuizLeaderboard({ eventId: 'event-1', expectedUserId: 'user-1' })
    ).resolves.toEqual({
      currentPlayer,
      entries: [currentPlayer],
      participantCount: 1,
      status: 'published',
    });
    expect(
      new Headers(mockFetch.mock.calls[0]?.[1]?.headers).get(
        'X-Baci-Quiz-Contract'
      )
    ).toBe('2');
  });
});
