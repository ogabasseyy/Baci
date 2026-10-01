import { describe, expect, it } from 'vitest';
import { isQuizAuthoringTimingValid } from './quiz-authoring-timing-valid';

describe('isQuizAuthoringTimingValid', () => {
  it('accepts immediate launches without schedule inputs', () => {
    // Arrange & Act
    const valid = isQuizAuthoringTimingValid({
      scheduledEnd: '',
      scheduledStart: '',
      timingKind: 'immediate',
    });

    // Assert
    expect(valid).toBe(true);
  });

  it('accepts a scheduled end after the start in the policy zone', () => {
    // Arrange & Act
    const valid = isQuizAuthoringTimingValid({
      scheduledEnd: '2026-05-20T10:05',
      scheduledStart: '2026-05-20T10:00',
      timingKind: 'scheduled',
    });

    // Assert
    expect(valid).toBe(true);
  });

  it('rejects a scheduled end that is not after the start', () => {
    // Arrange & Act
    const equal = isQuizAuthoringTimingValid({
      scheduledEnd: '2026-05-20T10:00',
      scheduledStart: '2026-05-20T10:00',
      timingKind: 'scheduled',
    });
    const reversed = isQuizAuthoringTimingValid({
      scheduledEnd: '2026-05-20T09:55',
      scheduledStart: '2026-05-20T10:00',
      timingKind: 'scheduled',
    });
    const missing = isQuizAuthoringTimingValid({
      scheduledEnd: '',
      scheduledStart: '2026-05-20T10:00',
      timingKind: 'scheduled',
    });

    // Assert
    expect(equal).toBe(false);
    expect(reversed).toBe(false);
    expect(missing).toBe(false);
  });
});
