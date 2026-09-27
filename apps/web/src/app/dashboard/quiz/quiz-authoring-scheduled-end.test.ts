import { describe, expect, it } from 'vitest';
import { resyncQuizAuthoringScheduledEnd } from './quiz-authoring-scheduled-end';

describe('resyncQuizAuthoringScheduledEnd', () => {
  it('derives the end from the start plus expected play in the policy zone', () => {
    // Arrange: 2 questions x 10s = 20s play, floored to 60s, in Lagos.
    // Act
    const end = resyncQuizAuthoringScheduledEnd({
      mode: 'test',
      questionCount: 2,
      scheduledStart: '2026-10-01T10:00',
      timePerQuestionSeconds: 10,
    });

    // Assert: 10:01 Lagos wall clock.
    expect(end).toBe('2026-10-01T10:01');
  });

  it('scales with the actual generated count, not the requested one', () => {
    // Arrange: 10 questions x 60s = 600s play in live mode.
    // Act
    const end = resyncQuizAuthoringScheduledEnd({
      mode: 'live',
      questionCount: 10,
      scheduledStart: '2026-10-01T10:00',
      timePerQuestionSeconds: 60,
    });

    // Assert
    expect(end).not.toBeNull();
    expect(
      Date.parse(`${end}:00+01:00`) - Date.parse('2026-10-01T10:00:00+01:00')
    ).toBeGreaterThanOrEqual(600_000);
  });

  it('returns null for an unparseable start', () => {
    // Arrange & Act & Assert
    expect(
      resyncQuizAuthoringScheduledEnd({
        mode: 'test',
        questionCount: 2,
        scheduledStart: 'not-a-date',
        timePerQuestionSeconds: 10,
      })
    ).toBeNull();
  });
});
