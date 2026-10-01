import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ apiGet: apiGetMock }));

const VALID_RESPONSE = {
  currentPlayer: null,
  entries: [
    {
      displayName: 'quizking',
      isCurrentCustomer: true,
      rank: 1,
      score: 5,
      status: 'scored',
      submittedAt: '2026-07-14T09:00:00.000Z',
      totalTimeSeconds: 30.5,
    },
  ],
  participantCount: 1,
  status: 'published',
};

describe('fetchQuizLeaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests the leaderboard for the given event and returns the entries', async () => {
    apiGetMock.mockResolvedValue(VALID_RESPONSE);

    const { fetchQuizLeaderboard } = await import('./fetch-quiz-leaderboard');
    const entries = await fetchQuizLeaderboard('event-123');

    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/quiz/leaderboard?eventId=event-123'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.displayName).toBe('quizking');
  });

  it('throws when the response does not match the schema', async () => {
    apiGetMock.mockResolvedValue({ entries: [{ rank: 'not-a-number' }] });

    const { fetchQuizLeaderboard } = await import('./fetch-quiz-leaderboard');

    await expect(fetchQuizLeaderboard('event-123')).rejects.toThrow(
      'Invalid quiz leaderboard response'
    );
  });
});
