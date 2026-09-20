import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import { defaultQuizAuthoringSchedule } from './quiz-authoring-schedule-defaults';
import {
  quizDatetimeLocalToIso,
  quizInstantToDatetimeLocal,
} from './quiz-datetime-local';

describe('defaultQuizAuthoringSchedule', () => {
  it('defaults the end five minutes after the start in the policy zone', () => {
    // Arrange: mid-minute instant so minute truncation keeps the gap exact.
    const nowMs = Date.UTC(2026, 4, 20, 9, 0, 30);

    // Act
    const schedule = defaultQuizAuthoringSchedule(nowMs);

    // Assert
    expect(schedule.scheduledStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(schedule.scheduledEnd).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(schedule.scheduledStart).toBe(
      quizInstantToDatetimeLocal(nowMs + 3_600_000, QUIZ_DEFAULT_TIME_ZONE)
    );
    const startMs = Date.parse(
      quizDatetimeLocalToIso(
        schedule.scheduledStart,
        QUIZ_DEFAULT_TIME_ZONE
      ) as string
    );
    const endMs = Date.parse(
      quizDatetimeLocalToIso(
        schedule.scheduledEnd,
        QUIZ_DEFAULT_TIME_ZONE
      ) as string
    );
    expect(endMs - startMs).toBe(300_000);
  });
});
