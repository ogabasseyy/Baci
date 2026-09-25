import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveQuizAuthoringClosesAt } from './quiz-authoring-close-preview';
import { quizDatetimeLocalToIso } from './quiz-datetime-local';

describe('resolveQuizAuthoringClosesAt', () => {
  const previousTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = previousTz;
  });

  it('describes the live window for immediate launches', () => {
    // Arrange & Act & Assert
    expect(
      resolveQuizAuthoringClosesAt({
        scheduledEnd: '2026-05-20T10:05',
        timingKind: 'immediate',
        windowMinutes: '5',
      })
    ).toBe('After 5m');
    expect(
      resolveQuizAuthoringClosesAt({
        scheduledEnd: '',
        timingKind: 'immediate',
        windowMinutes: '1',
      })
    ).toBe('After 1m');
  });

  it('falls back to the window text when no end is scheduled yet', () => {
    // Arrange & Act
    const closesAt = resolveQuizAuthoringClosesAt({
      scheduledEnd: '',
      timingKind: 'scheduled',
      windowMinutes: '5',
    });

    // Assert
    expect(closesAt).toBe('After 5m');
  });

  it('renders the scheduled end from the policy zone', () => {
    // Arrange
    const scheduledEnd = '2026-05-20T10:05';

    // Act
    const closesAt = resolveQuizAuthoringClosesAt({
      scheduledEnd,
      timingKind: 'scheduled',
      windowMinutes: '5',
    });

    // Assert
    expect(closesAt).toBe(
      new Date(
        quizDatetimeLocalToIso(scheduledEnd, QUIZ_DEFAULT_TIME_ZONE) as string
      ).toLocaleString(undefined, { timeZone: QUIZ_DEFAULT_TIME_ZONE })
    );
  });

  it('keeps the Lagos wall clock under a foreign browser timezone', () => {
    // Regression: formatting the instant in the admin browser's zone shows
    // 10:05 Lagos as 06:05 in New York, contradicting the form inputs that
    // activation still interprets as Lagos time.
    process.env.TZ = 'America/New_York';

    // Act
    const closesAt = resolveQuizAuthoringClosesAt({
      scheduledEnd: '2026-05-20T10:05',
      timingKind: 'scheduled',
      windowMinutes: '5',
    });

    // Assert
    expect(closesAt).toContain('10:05');
  });
});
