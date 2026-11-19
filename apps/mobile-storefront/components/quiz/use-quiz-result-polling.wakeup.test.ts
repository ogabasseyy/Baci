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

const pendingUntil = (availableAt: string | null): QuizV2Result => ({
  attemptId: 'attempt-1',
  availability: 'pending',
  availableAt,
});
// With no availability time the next ordinary poll is at least 24 s away,
// so any earlier request in these tests can only come from the wake-up.
const pendingResult = pendingUntil(null);

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
    // Centre of the retry spread: the failed first request retries at 5 s.
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest
      .mocked(fetchQuizResult)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(pendingResult);
    renderWakeupHook();
    await advance(0);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    // At 4 s a wake-up arrives and picks a 3.96 s delay (due at 7.96 s).
    await advance(4_000);
    random.mockReturnValue(0.99);
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

  it('keeps the first delay when wake-ups repeat', async () => {
    jest.mocked(fetchQuizResult).mockResolvedValue(pendingResult);
    renderWakeupHook();
    await advance(0);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    // The first wake-up picks 1 s. A second one half a second later would
    // pick 3.96 s if it restarted the timer.
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    await wakeUp();
    await advance(500);
    random.mockReturnValue(0.99);
    await wakeUp();
    await advance(499);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('spreads the poll at the event end over 0-4 s', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const eventEnd = new Date(Date.now() + 10_000).toISOString();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce(pendingUntil(eventEnd))
      .mockResolvedValue(pendingResult);
    renderWakeupHook();
    await advance(0);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    // Every phone is told the same event end; this one waits 2 s past it.
    await advance(10_000 + 1_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });

  it('spreads a failed poll retry between 4 s and 6 s', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    jest
      .mocked(fetchQuizResult)
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(pendingResult);
    renderWakeupHook();
    await advance(0);

    // 1st failure: 5 s at the lowest spread is 4 s.
    await advance(3_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    // The retry schedules the next one as soon as it fails, so the upper
    // bound has to be in place before it fires.
    random.mockReturnValue(1);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
    // 2nd failure: 10 s at the highest spread is 12 s.
    await advance(11_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'a far-off event end',
      () => new Date(Date.now() + 3_600_000).toISOString(),
    ],
    ['no availability time', () => null],
  ])('spreads the slow fallback poll for %s between 24 s and 36 s', async (_case, availableAt) => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.mocked(fetchQuizResult).mockResolvedValue(pendingUntil(availableAt()));
    renderWakeupHook();
    await advance(0);

    // 30 s at the lowest spread is 24 s.
    await advance(23_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    // The poll schedules the next one as soon as it resolves, so the upper
    // bound has to be in place before it fires.
    random.mockReturnValue(1);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
    // 30 s at the highest spread is 36 s.
    await advance(35_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(3);
  });

  it('never retries sooner than 15 s once the server says it is overloaded', async () => {
    // Lowest spread: an ordinary first failure would retry after 4 s.
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest
      .mocked(fetchQuizResult)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValue(pendingResult);
    renderWakeupHook();
    await advance(0);

    await advance(14_999);
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchQuizResult).toHaveBeenCalledTimes(2);
  });
});
