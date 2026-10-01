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

const { fetchQuizLiveLeaderboard } =
  require('./quiz-live-leaderboard') as typeof import('./quiz-live-leaderboard');

describe('fetchQuizLiveLeaderboard', () => {
  it('parses the live standings response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          currentPlayer: null,
          entries: [],
          participantCount: 2,
          status: 'live',
        }),
        { status: 200 }
      )
    );

    await expect(
      fetchQuizLiveLeaderboard({ eventId: 'event-1', expectedUserId: 'user-1' })
    ).resolves.toMatchObject({ status: 'live', participantCount: 2 });
  });
});
