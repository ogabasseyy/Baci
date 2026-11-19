import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import {
  QUIZ_RESULT_POLL_MAX_INTERVAL_MS,
  useQuizResultPolling,
} from './use-quiz-result-polling';

const mockQuizResultsWakeup = { current: null as (() => void) | null };

jest.mock('./use-quiz-result-realtime-wakeup', () => ({
  useQuizResultRealtimeWakeup: ({
    enabled,
    onWakeup,
  }: {
    enabled: boolean;
    onWakeup: () => void;
  }) => {
    mockQuizResultsWakeup.current = enabled ? onWakeup : null;
  },
}));

jest.mock('@/services/quiz-results', () => ({
  fetchQuizResult: jest.fn(),
}));

describe('useQuizResultPolling realtime and availability scheduling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockQuizResultsWakeup.current = null;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses the fallback when no publication wakeup arrives and then stops', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // centre: exactly 30 s
    const onResult = jest.fn();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt: '2026-08-09T20:26:20.000Z',
        rank: 1,
        score: 4,
        totalQuestions: 5,
      });

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventId: null,
        expectedUserId: 'user-1',
        onResult,
      })
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ availability: 'pending' })
      )
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ availability: 'final', rank: 1 })
    );
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('waits until the server availability time before retrying pending results', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // no spread after that time
    const availableAt = new Date(Date.now() + 20_000).toISOString();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'pending',
        availableAt,
      })
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt,
        rank: 1,
        score: 4,
        totalQuestions: 5,
      });

    const onResult = jest.fn();
    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventId: null,
        expectedUserId: 'user-1',
        onResult,
      })
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ availability: 'pending' })
      )
    );

    const remainingUntilAvailability = Date.parse(availableAt) - Date.now();
    await act(async () => {
      jest.advanceTimersByTime(remainingUntilAvailability - 1);
      await Promise.resolve();
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('caps the fallback when the device clock is behind server time', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // centre: exactly the cap
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'pending',
        availableAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      })
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt: new Date().toISOString(),
        rank: 1,
        score: 4,
        totalQuestions: 5,
      });

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventId: null,
        expectedUserId: 'user-1',
        onResult: jest.fn(),
      })
    );
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(QUIZ_RESULT_POLL_MAX_INTERVAL_MS);
    });

    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('waits for the private publication wakeup instead of polling every second', async () => {
    const availableAt = new Date(Date.now()).toISOString();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'pending',
        availableAt,
      })
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt,
        rank: 1,
        score: 4,
        totalQuestions: 5,
      });

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        onResult: jest.fn(),
      })
    );
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    await act(async () => {
      mockQuizResultsWakeup.current?.();
      await Promise.resolve();
    });
    // The wake-up is spread, not immediate.
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4_000);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  const pendingThenFinal = () => {
    const availableAt = new Date(Date.now()).toISOString();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-1',
        availability: 'pending',
        availableAt,
      })
      .mockResolvedValue({
        attemptId: 'attempt-1',
        availability: 'final',
        availableAt,
        rank: 1,
        score: 4,
        totalQuestions: 5,
      });
  };
  const renderWakeupHook = () =>
    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventId: 'event-1',
        expectedUserId: 'user-1',
        onResult: jest.fn(),
      })
    );

  it('delays the realtime wake-up poll by a random 0-4 s', async () => {
    pendingThenFinal();
    renderWakeupHook();
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));

    jest.spyOn(Math, 'random').mockReturnValue(0.25);
    await act(async () => {
      mockQuizResultsWakeup.current?.();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(999);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('cancels a delayed wake-up poll on unmount', async () => {
    pendingThenFinal();
    const { unmount } = renderWakeupHook();
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));

    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const wakeup = mockQuizResultsWakeup.current;
    await act(async () => {
      wakeup?.();
      await jest.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
  });
});
