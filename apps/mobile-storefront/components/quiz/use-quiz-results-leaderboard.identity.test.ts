import { act, renderHook, waitFor } from '@testing-library/react-native';
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
const board = {
  status: 'live' as const,
  participantCount: 1,
  entries: [],
  currentPlayer: {
    displayName: 'Me',
    isCurrentCustomer: true,
    rank: 1,
    score: 4,
    status: 'submitted',
    submittedAt: null,
    totalTimeSeconds: 2,
  },
};

afterEach(() => jest.clearAllMocks());

it('suppresses a late response after the signed-in account changes', async () => {
  let finish!: (value: typeof board) => void;
  let activeUser = 'user-1';
  jest.mocked(fetchQuizLiveLeaderboard).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const { result } = renderHook(() =>
    useQuizResultsLeaderboard({
      enabled: true,
      eventHasEnded: false,
      eventId: 'event-1',
      expectedUserId: 'user-1',
      lifecycle: 'pending_results',
      getCurrentUserId: () => activeUser,
    })
  );
  await waitFor(() => expect(fetchQuizLiveLeaderboard).toHaveBeenCalled());
  activeUser = 'user-2';
  await act(async () => {
    finish(board);
    await Promise.resolve();
  });
  expect(result.current.leaderboard).toBeNull();
});

it('suppresses a previously loaded score when eligibility is disabled', async () => {
  jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue(board);
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useQuizResultsLeaderboard({
        enabled,
        eventHasEnded: false,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        lifecycle: 'pending_results',
      }),
    { initialProps: { enabled: true } }
  );
  await waitFor(() =>
    expect(result.current.leaderboard?.currentPlayer?.score).toBe(4)
  );
  rerender({ enabled: false });
  expect(result.current.leaderboard).toBeNull();
});

it('clears a previously loaded score when access is revoked', async () => {
  jest.useFakeTimers();
  jest
    .mocked(fetchQuizLiveLeaderboard)
    .mockResolvedValueOnce(board)
    .mockRejectedValueOnce(
      new QuizServiceError('Access ended', 'not_authorized', 403)
    );
  const { result } = renderHook(() =>
    useQuizResultsLeaderboard({
      enabled: true,
      eventHasEnded: false,
      eventId: 'event-1',
      expectedUserId: 'user-1',
      lifecycle: 'pending_results',
    })
  );
  await waitFor(() =>
    expect(result.current.leaderboard?.currentPlayer?.score).toBe(4)
  );
  await act(async () => {
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
  });
  expect(result.current.leaderboard).toBeNull();
  jest.useRealTimers();
});

it('loads a personal live score after the event ends while publication is pending', async () => {
  jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue(board);
  const { result } = renderHook(() =>
    useQuizResultsLeaderboard({
      enabled: true,
      eventHasEnded: true,
      eventId: 'event-1',
      expectedUserId: 'user-1',
      lifecycle: 'pending_results',
      deferFinalUntilPublished: true,
    })
  );
  await waitFor(() =>
    expect(result.current.leaderboard?.currentPlayer?.score).toBe(4)
  );
  expect(fetchQuizLiveLeaderboard).toHaveBeenCalledTimes(1);
});

it('hides the previous event score and discards an old late response after event change', async () => {
  let finishOld!: (value: typeof board) => void;
  jest
    .mocked(fetchQuizLiveLeaderboard)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    )
    .mockReturnValueOnce(new Promise(() => {}));
  const { result, rerender } = renderHook(
    ({ eventId }: { eventId: string }) =>
      useQuizResultsLeaderboard({
        enabled: true,
        eventHasEnded: false,
        eventId,
        expectedUserId: 'user-1',
        lifecycle: 'pending_results',
      }),
    { initialProps: { eventId: 'event-1' } }
  );
  await waitFor(() =>
    expect(fetchQuizLiveLeaderboard).toHaveBeenCalledTimes(1)
  );
  rerender({ eventId: 'event-2' });
  expect(result.current.leaderboard).toBeNull();
  await act(async () => {
    finishOld(board);
    await Promise.resolve();
  });
  expect(result.current.leaderboard).toBeNull();
});

it('retries a temporary 401 while the same account remains signed in', async () => {
  jest.useFakeTimers();
  jest
    .mocked(fetchQuizLiveLeaderboard)
    .mockRejectedValueOnce(
      new QuizServiceError('Session pending', 'unauthorized', 401)
    )
    .mockResolvedValueOnce(board);
  const { result } = renderHook(() =>
    useQuizResultsLeaderboard({
      enabled: true,
      eventHasEnded: false,
      eventId: 'event-1',
      expectedUserId: 'user-1',
      lifecycle: 'pending_results',
      getCurrentUserId: () => 'user-1',
    })
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.leaderboard).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
  });
  expect(result.current.leaderboard?.currentPlayer?.score).toBe(4);
  jest.useRealTimers();
});

it('clears a previously shown score when the live projection becomes unavailable', async () => {
  jest.useFakeTimers();
  jest
    .mocked(fetchQuizLiveLeaderboard)
    .mockResolvedValueOnce(board)
    .mockResolvedValueOnce({
      status: 'unavailable',
      participantCount: null,
      entries: [],
      currentPlayer: null,
    });
  const { result } = renderHook(() =>
    useQuizResultsLeaderboard({
      enabled: true,
      eventHasEnded: false,
      eventId: 'event-1',
      expectedUserId: 'user-1',
      lifecycle: 'pending_results',
    })
  );
  await waitFor(() =>
    expect(result.current.leaderboard?.currentPlayer?.score).toBe(4)
  );
  await act(async () => {
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
  });
  expect(result.current.leaderboard).toBeNull();
  jest.useRealTimers();
});

it('hides live rankings when transitioning to final even if the published fetch fails', async () => {
  jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue(board);
  jest
    .mocked(fetchQuizLeaderboard)
    .mockRejectedValue(new Error('not published'));
  const { result, rerender } = renderHook(
    ({ lifecycle }: { lifecycle: 'pending_results' | 'final' }) =>
      useQuizResultsLeaderboard({
        enabled: true,
        eventHasEnded: false,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        lifecycle,
        deferFinalUntilPublished: true,
      }),
    { initialProps: { lifecycle: 'pending_results' as const } }
  );
  await waitFor(() => expect(result.current.leaderboard?.status).toBe('live'));
  rerender({ lifecycle: 'final' });
  await waitFor(() => expect(fetchQuizLeaderboard).toHaveBeenCalled());
  expect(result.current.leaderboard).toBeNull();
});

it('hides an existing score when the subscribed account changes', async () => {
  jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue(board);
  const { result, rerender } = renderHook(
    ({ currentUser }: { currentUser: string }) =>
      useQuizResultsLeaderboard({
        enabled: true,
        eventHasEnded: false,
        eventId: 'event-1',
        expectedUserId: currentUser,
        lifecycle: 'pending_results',
        getCurrentUserId: () => currentUser,
      }),
    { initialProps: { currentUser: 'user-1' } }
  );
  await waitFor(() =>
    expect(result.current.leaderboard?.currentPlayer?.score).toBe(4)
  );
  jest.mocked(fetchQuizLiveLeaderboard).mockReturnValue(new Promise(() => {}));
  rerender({ currentUser: 'user-2' });
  expect(result.current.leaderboard).toBeNull();
});
