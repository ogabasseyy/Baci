import { act, renderHook } from '@testing-library/react-native';
import {
  QUIZ_AUTO_SUBMIT_LEAD_MS,
  useQuizQuestionTimer,
} from './use-quiz-question-timer';

describe('useQuizQuestionTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts at the full time limit', () => {
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        questionId: 'q1',
        timeLimitSeconds: 30,
        isActive: true,
        hasSelection: false,
        onExpire: jest.fn(),
      })
    );

    expect(result.current.remainingSeconds).toBe(30);
    expect(result.current.isExpiring).toBe(false);
  });

  it('counts down as time elapses', () => {
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        questionId: 'q1',
        timeLimitSeconds: 30,
        isActive: true,
        hasSelection: false,
        onExpire: jest.fn(),
      })
    );

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(result.current.remainingSeconds).toBe(20);
  });

  it('anchors remaining time to the server-issued deadline when present', () => {
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        questionId: 'q1',
        timeLimitSeconds: 30,
        deadlineAt: new Date(8000).toISOString(),
        isActive: true,
        hasSelection: false,
        onExpire: jest.fn(),
      })
    );

    expect(result.current.remainingSeconds).toBe(8);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.remainingSeconds).toBe(5);
  });

  it('auto-submits a SELECTED answer exactly once, at the early lead', () => {
    const onExpire = jest.fn();
    renderHook(() =>
      useQuizQuestionTimer({
        questionId: 'q1',
        timeLimitSeconds: 5,
        isActive: true,
        hasSelection: true,
        onExpire,
      })
    );

    // Advance past (limit - lead) so the auto-submit threshold is crossed.
    act(() => {
      jest.advanceTimersByTime(5_000 - QUIZ_AUTO_SUBMIT_LEAD_MS + 500);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    // Further ticks must not fire it again for the same question.
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not fire again for the same question when the server clock offset changes', () => {
    const onExpire = jest.fn();
    const { rerender } = renderHook(
      ({ serverClockOffsetMs }: { serverClockOffsetMs: number }) =>
        useQuizQuestionTimer({
          deadlineAt: new Date(1000).toISOString(),
          hasSelection: false,
          isActive: true,
          onExpire,
          questionId: 'q1',
          serverClockOffsetMs,
          timeLimitSeconds: 5,
        }),
      { initialProps: { serverClockOffsetMs: 1000 } }
    );

    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender({ serverClockOffsetMs: 1500 });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('keeps a local fallback window stable when the server clock recalibrates', () => {
    const onExpire = jest.fn();
    const { result, rerender } = renderHook(
      ({ serverClockOffsetMs }: { serverClockOffsetMs: number }) =>
        useQuizQuestionTimer({
          hasSelection: false,
          isActive: true,
          onExpire,
          questionId: 'q-local-fallback',
          serverClockOffsetMs,
          timeLimitSeconds: 10,
        }),
      { initialProps: { serverClockOffsetMs: 0 } }
    );

    act(() => jest.advanceTimersByTime(3000));
    expect(result.current.remainingSeconds).toBe(7);

    rerender({ serverClockOffsetMs: 5000 });
    expect(result.current.remainingSeconds).toBe(7);

    act(() => jest.advanceTimersByTime(7000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does NOT forfeit an unanswered question at the lead — only at the real deadline', () => {
    const onExpire = jest.fn();
    renderHook(() =>
      useQuizQuestionTimer({
        questionId: 'q1',
        timeLimitSeconds: 5,
        isActive: true,
        hasSelection: false,
        onExpire,
      })
    );

    // Inside the lead window but before the deadline: the player still has
    // time to pick an option, so no forfeit yet.
    act(() => {
      jest.advanceTimersByTime(5_000 - QUIZ_AUTO_SUBMIT_LEAD_MS + 500);
    });
    expect(onExpire).not.toHaveBeenCalled();

    // At the actual deadline the forfeit fires (once).
    act(() => {
      jest.advanceTimersByTime(QUIZ_AUTO_SUBMIT_LEAD_MS);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('fires at the lead when a selection is made inside the lead window', () => {
    const onExpire = jest.fn();
    const { rerender } = renderHook(
      ({ hasSelection }: { hasSelection: boolean }) =>
        useQuizQuestionTimer({
          questionId: 'q1',
          timeLimitSeconds: 5,
          isActive: true,
          hasSelection,
          onExpire,
        }),
      { initialProps: { hasSelection: false } }
    );

    // Enter the lead window unanswered — no fire.
    act(() => {
      jest.advanceTimersByTime(5_000 - QUIZ_AUTO_SUBMIT_LEAD_MS + 250);
    });
    expect(onExpire).not.toHaveBeenCalled();

    // Player picks an option with ~1.25s left: next tick auto-submits it.
    rerender({ hasSelection: true });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not run while inactive', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        questionId: 'q1',
        timeLimitSeconds: 5,
        isActive: false,
        hasSelection: false,
        onExpire,
      })
    );

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(onExpire).not.toHaveBeenCalled();
    expect(result.current.remainingSeconds).toBe(5);
  });

  it('resets the countdown when a new question arrives', () => {
    const onExpire = jest.fn();
    const { result, rerender } = renderHook(
      ({ questionId }: { questionId: string }) =>
        useQuizQuestionTimer({
          questionId,
          timeLimitSeconds: 30,
          isActive: true,
          hasSelection: false,
          onExpire,
        }),
      { initialProps: { questionId: 'q1' } }
    );

    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(result.current.remainingSeconds).toBe(10);

    rerender({ questionId: 'q2' });
    expect(result.current.remainingSeconds).toBe(30);
  });
});
