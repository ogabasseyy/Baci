import { act, renderHook } from '@testing-library/react-native';
import { useQuizQuestionTimer } from './use-quiz-question-timer';

describe('useQuizQuestionTimer deadline handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('unanswered_timeout_submits_once', () => {
    // Arrange
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        deadlineAt: new Date(1_000).toISOString(),
        hasSelection: false,
        isActive: true,
        onExpire,
        questionId: 'q-unanswered',
        timeLimitSeconds: 30,
      })
    );

    // Act
    act(() => {
      jest.advanceTimersByTime(2_000);
    });

    // Assert
    expect(result.current.remainingSeconds).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('event_end_caps_question_timer_with_server_offset', () => {
    // Arrange
    jest.setSystemTime(new Date('2026-08-04T09:04:50.000Z'));
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        deadlineAt: '2026-08-04T09:05:05.000Z',
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        hasSelection: false,
        isActive: true,
        onExpire,
        questionId: 'q-late',
        serverClockOffsetMs: 5000,
        timeLimitSeconds: 10,
      })
    );

    // Act
    expect(result.current.remainingSeconds).toBe(5);
    act(() => jest.advanceTimersByTime(5000));

    // Assert
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('caps_observable_remaining_time_at_event_end', () => {
    // Arrange
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizQuestionTimer({
        deadlineAt: new Date(20_000).toISOString(),
        eventEndsAt: new Date(10_000).toISOString(),
        hasSelection: false,
        isActive: true,
        onExpire,
        questionId: 'q-event-cap',
        serverClockOffsetMs: 2_000,
        timeLimitSeconds: 20,
      })
    );

    // Act
    act(() => {
      jest.advanceTimersByTime(8_250);
    });

    // Assert
    expect(result.current.remainingSeconds).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
