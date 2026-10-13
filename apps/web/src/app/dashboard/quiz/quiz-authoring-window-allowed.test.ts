import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { isQuizAuthoringWindowAllowed } from './quiz-authoring-window-allowed';
import { quizInstantToDatetimeLocal } from './quiz-datetime-local';

describe('isQuizAuthoringWindowAllowed', () => {
  const nowMs = Date.UTC(2026, 4, 20, 9, 0, 0);
  const startWall = quizInstantToDatetimeLocal(
    nowMs + 3_600_000,
    QUIZ_DEFAULT_TIME_ZONE
  ) as string;

  it('accepts a future scheduled window inside the launch bounds', () => {
    // Arrange: 120s window for 2 questions at 10s each in test mode.
    const endWall = quizInstantToDatetimeLocal(
      nowMs + 3_600_000 + 120_000,
      QUIZ_DEFAULT_TIME_ZONE
    ) as string;

    // Act
    const allowed = isQuizAuthoringWindowAllowed({
      liveWindowMinutes: 5,
      mode: 'test',
      nowMs,
      questionCount: 2,
      scheduledEnd: endWall,
      scheduledStart: startWall,
      timePerQuestionSeconds: 10,
      timingKind: 'scheduled',
    });

    // Assert
    expect(allowed).toBe(true);
  });

  it('rejects a scheduled start that has already expired', () => {
    // Arrange: the page stayed open past the scheduled start, which
    // quiz-launch-v2 rejects as not in the future.
    const endWall = quizInstantToDatetimeLocal(
      nowMs + 3_600_000 + 120_000,
      QUIZ_DEFAULT_TIME_ZONE
    ) as string;

    // Act
    const allowed = isQuizAuthoringWindowAllowed({
      liveWindowMinutes: 5,
      mode: 'test',
      nowMs: nowMs + 3_600_000 + 1,
      questionCount: 2,
      scheduledEnd: endWall,
      scheduledStart: startWall,
      timePerQuestionSeconds: 10,
      timingKind: 'scheduled',
    });

    // Assert
    expect(allowed).toBe(false);
  });

  it('rejects an immediate live window outside the launch bounds', () => {
    // Arrange: a 20-question, 10-second live quiz with a one-minute
    // immediate window is below the question-derived minimum.
    // Act
    const allowed = isQuizAuthoringWindowAllowed({
      liveWindowMinutes: 1,
      mode: 'live',
      nowMs,
      questionCount: 20,
      scheduledEnd: '',
      scheduledStart: '',
      timePerQuestionSeconds: 10,
      timingKind: 'immediate',
    });

    // Assert
    expect(allowed).toBe(false);
  });

  it('accepts an immediate window inside the launch bounds', () => {
    // Arrange & Act
    const allowed = isQuizAuthoringWindowAllowed({
      liveWindowMinutes: 5,
      mode: 'test',
      nowMs,
      questionCount: 2,
      scheduledEnd: '',
      scheduledStart: '',
      timePerQuestionSeconds: 10,
      timingKind: 'immediate',
    });

    // Assert
    expect(allowed).toBe(true);
  });

  it('rejects a manually shrunk window outside the launch bounds', () => {
    // Regression: a one-minute window for a 20-question quiz passes
    // interval-order validation but activation would reject it, wasting
    // the AI draft request.
    // Live bounds for 20 questions at 10 seconds each are [230, 320]
    // seconds; nowMs sits the day before the fixed walls so the starts
    // read as future.
    const liveQuiz = {
      liveWindowMinutes: 5,
      mode: 'live' as const,
      nowMs: Date.UTC(2026, 8, 19),
      questionCount: 20,
      timePerQuestionSeconds: 10,
      timingKind: 'scheduled' as const,
    };
    expect(
      isQuizAuthoringWindowAllowed({
        ...liveQuiz,
        scheduledEnd: '2026-09-20T17:01',
        scheduledStart: '2026-09-20T17:00',
      })
    ).toBe(false);
  });

  it('accepts a window inside the launch bounds', () => {
    const liveQuiz = {
      liveWindowMinutes: 5,
      mode: 'live' as const,
      nowMs: Date.UTC(2026, 8, 19),
      questionCount: 20,
      timePerQuestionSeconds: 10,
      timingKind: 'scheduled' as const,
    };
    expect(
      isQuizAuthoringWindowAllowed({
        ...liveQuiz,
        scheduledEnd: '2026-09-20T17:05',
        scheduledStart: '2026-09-20T17:00',
      })
    ).toBe(true);
  });

  it('still rejects an end before the start', () => {
    const liveQuiz = {
      liveWindowMinutes: 5,
      mode: 'live' as const,
      nowMs: Date.UTC(2026, 8, 19),
      questionCount: 20,
      timePerQuestionSeconds: 10,
      timingKind: 'scheduled' as const,
    };
    expect(
      isQuizAuthoringWindowAllowed({
        ...liveQuiz,
        scheduledEnd: '2026-09-20T17:00',
        scheduledStart: '2026-09-20T17:05',
      })
    ).toBe(false);
  });

  it('allows an immediate launch inside the window bounds', () => {
    // A five-minute immediate window is 300 seconds, inside [230, 320].
    const liveQuiz = {
      liveWindowMinutes: 5,
      mode: 'live' as const,
      nowMs: Date.UTC(2026, 8, 19),
      questionCount: 20,
      timePerQuestionSeconds: 10,
      timingKind: 'immediate' as const,
    };
    expect(
      isQuizAuthoringWindowAllowed({
        ...liveQuiz,
        scheduledEnd: '',
        scheduledStart: '',
      })
    ).toBe(true);
  });
});
