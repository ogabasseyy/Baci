import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { quizAuthoringIntervalMs } from './quiz-authoring-interval';
import { quizDatetimeLocalToIso } from './quiz-datetime-local';

describe('quizAuthoringIntervalMs', () => {
  it('converts policy-zone walls to epoch milliseconds', () => {
    // Arrange & Act
    const interval = quizAuthoringIntervalMs(
      '2026-05-20T10:00',
      '2026-05-20T10:05'
    );

    // Assert
    expect(interval).toEqual({
      endMs: Date.parse(
        quizDatetimeLocalToIso(
          '2026-05-20T10:05',
          QUIZ_DEFAULT_TIME_ZONE
        ) as string
      ),
      startMs: Date.parse(
        quizDatetimeLocalToIso(
          '2026-05-20T10:00',
          QUIZ_DEFAULT_TIME_ZONE
        ) as string
      ),
    });
  });

  it('returns null when either input is empty or unparseable', () => {
    // Arrange & Act & Assert
    expect(quizAuthoringIntervalMs('', '2026-05-20T10:05')).toBeNull();
    expect(quizAuthoringIntervalMs('2026-05-20T10:00', '')).toBeNull();
    expect(
      quizAuthoringIntervalMs('not-a-date', '2026-05-20T10:05')
    ).toBeNull();
  });
});
