import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import { useQuizResultPolling } from './use-quiz-result-polling';

jest.mock('@/services/quiz-results', () => ({
  fetchQuizResult: jest.fn(),
}));

describe('useQuizResultPolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('polls pending results until publication and then stops', async () => {
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
        expectedUserId: 'user-1',
        onResult,
      })
    );
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(5_000);
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

  it('pauses pending-result polling while the app is backgrounded', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener);
        return { remove: jest.fn() };
      });
    jest.mocked(fetchQuizResult).mockResolvedValue({
      attemptId: 'attempt-1',
      availability: 'pending',
      availableAt: null,
    });
    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        expectedUserId: 'user-1',
        onResult: jest.fn(),
      })
    );
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    act(() => listeners[0]?.('background'));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    act(() => listeners[0]?.('active'));
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(2));
  });

  it('resumes polling when the app returns while a result request is in flight', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener);
        return { remove: jest.fn() };
      });
    let resolveFirst!: (result: {
      attemptId: string;
      availability: 'pending';
      availableAt: null;
    }) => void;
    const firstRequest = new Promise<{
      attemptId: string;
      availability: 'pending';
      availableAt: null;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    jest
      .mocked(fetchQuizResult)
      .mockReturnValueOnce(firstRequest)
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
        expectedUserId: 'user-1',
        onResult: jest.fn(),
      })
    );
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    act(() => {
      listeners[0]?.('background');
      listeners[0]?.('active');
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        attemptId: 'attempt-1',
        availability: 'pending',
        availableAt: null,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(2));
  });

  it('delays polling until the server-adjusted event end', async () => {
    jest.setSystemTime(new Date('2026-08-09T20:00:00.000Z'));
    jest.mocked(fetchQuizResult).mockResolvedValue({
      attemptId: 'attempt-1',
      availability: 'final',
      availableAt: '2026-08-09T20:01:05.000Z',
      rank: 1,
      score: 4,
      totalQuestions: 5,
    });

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventEndsAt: '2026-08-09T20:01:00.000Z',
        expectedUserId: 'user-1',
        onResult: jest.fn(),
        serverNow: '2026-08-09T20:00:00.000Z',
      })
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(fetchQuizResult).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
  });

  it('polls immediately when the event end is unknown', async () => {
    jest.mocked(fetchQuizResult).mockResolvedValue({
      attemptId: 'attempt-1',
      availability: 'final',
      availableAt: '2026-08-09T20:01:05.000Z',
      rank: 1,
      score: 4,
      totalQuestions: 5,
    });

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-1',
        enabled: true,
        eventEndsAt: null,
        expectedUserId: 'user-1',
        onResult: jest.fn(),
        serverNow: null,
      })
    );

    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
  });
});
