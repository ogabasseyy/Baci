import { act, renderHook } from '@testing-library/react-native';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizLiveLeaderboard } from '@/services/quiz-live-leaderboard';
import { QuizServiceError } from '@/services/quiz-types';
import { useQuizResultsLeaderboard } from './use-quiz-results-leaderboard';

jest.mock('@/services/quiz-leaderboard', () => ({
  fetchQuizLeaderboard: jest.fn(),
}));
jest.mock('@/services/quiz-live-leaderboard', () => ({
  fetchQuizLiveLeaderboard: jest.fn(),
}));

describe('useQuizResultsLeaderboard', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('refresh timing', () => {
    const liveBoard = {
      currentPlayer: null,
      entries: [],
      participantCount: 3,
      status: 'live' as const,
    };
    const renderLive = () =>
      renderHook(() =>
        useQuizResultsLeaderboard({
          enabled: true,
          eventHasEnded: false,
          eventId: 'event-1',
          expectedUserId: 'user-1',
          lifecycle: 'pending_results',
        })
      );
    const liveCalls = () =>
      jest.mocked(fetchQuizLiveLeaderboard).mock.calls.length;
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };

    it('refreshes at the 10 s base interval when the spread is centred', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue(liveBoard);
      renderLive();

      await advance(0);
      expect(liveCalls()).toBe(1);
      await advance(9_999);
      expect(liveCalls()).toBe(1);
      await advance(1);
      expect(liveCalls()).toBe(2);
    });

    it('spreads the live refresh between 8 s and 12 s', async () => {
      jest.useFakeTimers();
      const random = jest.spyOn(Math, 'random').mockReturnValue(0);
      jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue(liveBoard);
      renderLive();

      await advance(0);
      await advance(7_999);
      expect(liveCalls()).toBe(1);
      // The second refresh schedules the third as soon as it resolves, so the
      // upper bound has to be in place before that refresh fires.
      random.mockReturnValue(1);
      await advance(1);
      expect(liveCalls()).toBe(2);

      await advance(11_999);
      expect(liveCalls()).toBe(2);
      await advance(1);
      expect(liveCalls()).toBe(3);
    });

    it('backs off exponentially on repeated server errors and resets on success', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      jest
        .mocked(fetchQuizLiveLeaderboard)
        .mockRejectedValueOnce(new QuizServiceError('boom', 'server', 500))
        .mockRejectedValueOnce(new QuizServiceError('boom', 'server', 500))
        .mockRejectedValueOnce(new QuizServiceError('boom', 'server', 500))
        .mockResolvedValue(liveBoard);
      renderLive();

      await advance(0);
      expect(liveCalls()).toBe(1);
      // 1st failure: 10 s.
      await advance(9_999);
      expect(liveCalls()).toBe(1);
      await advance(1);
      expect(liveCalls()).toBe(2);
      // 2nd failure: 20 s.
      await advance(19_999);
      expect(liveCalls()).toBe(2);
      await advance(1);
      expect(liveCalls()).toBe(3);
      // 3rd failure: 40 s.
      await advance(39_999);
      expect(liveCalls()).toBe(3);
      await advance(1);
      expect(liveCalls()).toBe(4);
      // Success resets to the 10 s base interval.
      await advance(10_000);
      expect(liveCalls()).toBe(5);
    });

    it('caps the failure backoff at 60 s', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      jest
        .mocked(fetchQuizLiveLeaderboard)
        .mockRejectedValue(new QuizServiceError('boom', 'server', 500));
      renderLive();

      // Delays: 10, 20, 40, then capped at 60, 60.
      await advance(0);
      await advance(10_000 + 20_000 + 40_000);
      expect(liveCalls()).toBe(4);
      await advance(59_999);
      expect(liveCalls()).toBe(4);
      await advance(1);
      expect(liveCalls()).toBe(5);
      await advance(60_000);
      expect(liveCalls()).toBe(6);
    });

    it.each([
      429, 503,
    ])('never retries sooner than 15 s after a %i', async (status) => {
      jest.useFakeTimers();
      // Lowest spread: the 10 s base would otherwise retry after 8 s.
      jest.spyOn(Math, 'random').mockReturnValue(0);
      jest
        .mocked(fetchQuizLiveLeaderboard)
        .mockRejectedValueOnce(
          new QuizServiceError('busy', 'overloaded', status)
        )
        .mockResolvedValue(liveBoard);
      renderLive();

      await advance(0);
      await advance(14_999);
      expect(liveCalls()).toBe(1);
      await advance(1);
      expect(liveCalls()).toBe(2);
    });

    it('spreads and backs off the final-board retry', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      jest
        .mocked(fetchQuizLeaderboard)
        .mockRejectedValue(new Error('not published'));
      renderHook(() =>
        useQuizResultsLeaderboard({
          enabled: true,
          eventHasEnded: true,
          eventId: 'event-1',
          expectedUserId: 'user-1',
          lifecycle: 'pending_results',
        })
      );
      const finalCalls = () =>
        jest.mocked(fetchQuizLeaderboard).mock.calls.length;

      await advance(0);
      expect(finalCalls()).toBe(1);
      await advance(10_000);
      expect(finalCalls()).toBe(2);
      await advance(19_999);
      expect(finalCalls()).toBe(2);
      await advance(1);
      expect(finalCalls()).toBe(3);
    });
  });
});
