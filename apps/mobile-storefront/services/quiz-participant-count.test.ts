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

const { fetchQuizParticipantCount } =
  require('./quiz-participant-count') as typeof import('./quiz-participant-count');

describe('fetchQuizParticipantCount', () => {
  it('returns the validated participant count', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ participantCount: 12 }), { status: 200 })
    );

    await expect(
      fetchQuizParticipantCount({
        eventId: 'event-1',
        expectedUserId: 'user-1',
      })
    ).resolves.toBe(12);
  });
});
