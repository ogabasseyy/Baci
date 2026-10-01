import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isQuizAuthoringTimingValid } from './quiz-authoring-timing-valid';
import { useQuizAuthoringSchedule } from './use-quiz-authoring-schedule';

describe('useQuizAuthoringSchedule', () => {
  it('provides policy-zone defaults with the end after the start', () => {
    // Arrange & Act
    const { result } = renderHook(() =>
      useQuizAuthoringSchedule(Date.UTC(2026, 4, 20, 9, 0, 30))
    );

    // Assert
    expect(result.current.scheduledStart).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
    );
    expect(
      isQuizAuthoringTimingValid({
        scheduledEnd: result.current.scheduledEnd,
        scheduledStart: result.current.scheduledStart,
        timingKind: 'scheduled',
      })
    ).toBe(true);
  });
});
