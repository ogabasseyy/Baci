import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizV2Result } from '@/services/quiz-types';
import { useQuizResultPolling } from './use-quiz-result-polling';

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

// With no availability time the next ordinary poll is 30 s away, so any
// earlier request in these tests can only come from the wake-up.
const pendingResult: QuizV2Result = {
  attemptId: 'attempt-1',
  availability: 'pending',
  availableAt: null,
};

describe('useQuizResultPolling wake-up and ordinary polls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockQuizResultsWakeup.current = null;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

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
  const advance = async (ms: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };
  const wakeUp = async () => {
    await act(async () => {
      mockQuizResultsWakeup.current?.();
      await jest.advanceTimersByTimeAsync(0);
    });
  };

  it('drops a pending wake-up poll once an ordinary poll has run', async () => {
    jest
      .mocked(fetchQuizResult)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(pendingResult);
    renderWakeupHook();
    // The failed first request retries after 5 s.
    await advance(0);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    // At 4 s a wake-up arrives and picks a 3.96 s delay (due at 7.96 s).
    await advance(4_000);
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    await wakeUp();
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    // The ordinary retry at 5 s already asks the server for the result...
    await advance(1_000);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
    // ...so the wake-up must not send a second request behind it.
    await advance(4_000);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('keeps a wake-up that arrives while an earlier poll is in flight', async () => {
    let finishFirst: (result: QuizV2Result) => void = () => undefined;
    jest
      .mocked(fetchQuizResult)
      .mockImplementationOnce(
        () =>
          new Promise<QuizV2Result>((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockResolvedValue(pendingResult);
    renderWakeupHook();
    await advance(0);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    // The request in flight may have read the result before publication, so
    // the wake-up (2 s delay here) still has to poll again.
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    await wakeUp();
    await act(async () => {
      finishFirst(pendingResult);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await advance(1_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });
});
