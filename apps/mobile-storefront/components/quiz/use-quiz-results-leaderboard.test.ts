import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizLiveLeaderboard } from '@/services/quiz-live-leaderboard';
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

  it('loads live standings before the universal quiz window closes', async () => {
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [],
      participantCount: 3,
      status: 'live',
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

    await waitFor(() => expect(result.current.participantCount).toBe(3));
    expect(fetchQuizLiveLeaderboard).toHaveBeenCalledWith({
      eventId: 'event-1',
      expectedUserId: 'user-1',
    });
    expect(fetchQuizLeaderboard).not.toHaveBeenCalled();
  });

  it('uses the count returned with live standings without a second request', async () => {
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [],
      participantCount: 3,
      status: 'live',
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
      expect(result.current.leaderboard?.status).toBe('live')
    );
    await waitFor(() => expect(result.current.participantCount).toBe(3));
  });

  it('keeps live standings during a failed first final request', async () => {
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [],
      participantCount: null,
      status: 'live',
    });
    jest
      .mocked(fetchQuizLeaderboard)
      .mockRejectedValue(new Error('not published'));
    const { result, rerender } = renderHook(
      (props: { eventHasEnded: boolean }) =>
        useQuizResultsLeaderboard({
          enabled: true,
          eventHasEnded: props.eventHasEnded,
          eventId: 'event-1',
          expectedUserId: 'user-1',
          lifecycle: 'pending_results',
        }),
      { initialProps: { eventHasEnded: false } }
    );

    await waitFor(() =>
      expect(result.current.leaderboard?.status).toBe('live')
    );
    rerender({ eventHasEnded: true });

    await waitFor(() => {
      expect(fetchQuizLeaderboard).toHaveBeenCalledTimes(1);
      expect(result.current.leaderboard?.status).toBe('live');
      expect(result.current.leaderboardError).toBe(false);
    });
  });

  it('retries final standings after a transient publication failure', async () => {
    jest.useFakeTimers();
    jest
      .mocked(fetchQuizLeaderboard)
      .mockRejectedValueOnce(new Error('not published'))
      .mockResolvedValueOnce({
        currentPlayer: null,
        entries: [],
        participantCount: 1,
        status: 'published',
      });
    const { result } = renderHook(() =>
      useQuizResultsLeaderboard({
        enabled: true,
        eventHasEnded: true,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        lifecycle: 'pending_results',
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.leaderboardError).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(fetchQuizLeaderboard).toHaveBeenCalledTimes(2);
    expect(result.current.leaderboard?.status).toBe('published');
  });

  it('pauses live standings refresh in the background and resumes in the foreground', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener);
        return { remove: jest.fn() };
      });
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [],
      participantCount: 3,
      status: 'live',
    });
    jest.useFakeTimers();

    renderHook(() =>
      useQuizResultsLeaderboard({
        enabled: true,
        eventHasEnded: false,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        lifecycle: 'pending_results',
      })
    );
    await waitFor(() =>
      expect(fetchQuizLiveLeaderboard).toHaveBeenCalledTimes(1)
    );

    act(() => listeners[0]?.('background'));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fetchQuizLiveLeaderboard).toHaveBeenCalledTimes(1);

    act(() => listeners[0]?.('active'));
    await waitFor(() =>
      expect(fetchQuizLiveLeaderboard).toHaveBeenCalledTimes(2)
    );
  });

  it('keeps live refreshes bounded for players behind one carrier NAT', async () => {
    jest.useFakeTimers();
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [],
      participantCount: 3,
      status: 'live',
    });

    renderHook(() =>
      useQuizResultsLeaderboard({
        enabled: true,
        eventHasEnded: false,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        lifecycle: 'pending_results',
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // One immediate load plus one five-second refresh per minute. The route
    // has a dedicated bucket, so several players can share an IP safely.
    expect(
      jest.mocked(fetchQuizLiveLeaderboard).mock.calls.length
    ).toBeLessThanOrEqual(13);
  });
});
