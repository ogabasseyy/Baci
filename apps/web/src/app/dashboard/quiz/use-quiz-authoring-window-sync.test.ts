import {
  getSuggestedQuizLiveWindowSeconds,
  QUIZ_DEFAULT_TIME_ZONE,
} from '@baci/shared';
import { renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  quizDatetimeLocalToIso,
  quizInstantToDatetimeLocal,
} from './quiz-datetime-local';
import {
  defaultQuizAuthoringSchedule,
  isQuizAuthoringTimingValid,
  resolveQuizAuthoringClosesAt,
  resolveQuizAuthoringWindowSeconds,
  useQuizAuthoringSchedule,
  useQuizAuthoringWindowSync,
} from './use-quiz-authoring-window-sync';

const START_WALL_CLOCK = '2026-05-20T10:00';

function startInstantMs(): number {
  const iso = quizDatetimeLocalToIso(START_WALL_CLOCK, QUIZ_DEFAULT_TIME_ZONE);
  if (!iso) throw new Error('test start wall clock must parse');
  return Date.parse(iso);
}

type HarnessProps = {
  endTouched: boolean;
  mode: 'test' | 'live';
  questionCount: number;
  scheduledStart: string;
  timePerQuestionSeconds: number;
};

function useHarnessEnd({
  endTouched,
  mode,
  questionCount,
  scheduledStart,
  timePerQuestionSeconds,
}: HarnessProps): string {
  const [scheduledEnd, setScheduledEnd] = useState('preset');
  useQuizAuthoringWindowSync({
    endTouched,
    mode,
    questionCount,
    scheduledStart,
    setScheduledEnd,
    timePerQuestionSeconds,
  });
  return scheduledEnd;
}

describe('resolveQuizAuthoringWindowSeconds', () => {
  it('floors test mode to 60 seconds when no questions exist yet', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'test',
      questionCount: 0,
      timePerQuestionSeconds: 10,
    });

    // Assert
    expect(seconds).toBe(60);
  });

  it('uses raw expected play in test mode once it exceeds the floor', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'test',
      questionCount: 2,
      timePerQuestionSeconds: 35,
    });

    // Assert
    expect(seconds).toBe(70);
  });

  it('tracks the shared suggested live window in live mode', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'live',
      questionCount: 2,
      timePerQuestionSeconds: 10,
    });

    // Assert: 20s of play plus the documented grace, whole minutes.
    expect(seconds).toBe(120);
    expect(seconds).toBe(getSuggestedQuizLiveWindowSeconds(2, 10));
  });

  it('floors live mode when no questions exist yet', () => {
    // Arrange & Act
    const seconds = resolveQuizAuthoringWindowSeconds({
      mode: 'live',
      questionCount: 0,
      timePerQuestionSeconds: 10,
    });

    // Assert
    expect(seconds).toBe(60);
  });
});

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

describe('resolveQuizAuthoringClosesAt', () => {
  it('describes the live window for immediate launches', () => {
    // Arrange & Act & Assert
    expect(
      resolveQuizAuthoringClosesAt({
        scheduledEnd: '2026-05-20T10:05',
        timingKind: 'immediate',
        windowMinutes: '5',
      })
    ).toBe('About 5 minutes after launch');
    expect(
      resolveQuizAuthoringClosesAt({
        scheduledEnd: '',
        timingKind: 'immediate',
        windowMinutes: '1',
      })
    ).toBe('About 1 minute after launch');
  });

  it('falls back to the window text when no end is scheduled yet', () => {
    // Arrange & Act
    const closesAt = resolveQuizAuthoringClosesAt({
      scheduledEnd: '',
      timingKind: 'scheduled',
      windowMinutes: '5',
    });

    // Assert
    expect(closesAt).toBe('About 5 minutes after launch');
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
      ).toLocaleString()
    );
  });
});

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

describe('useQuizAuthoringWindowSync', () => {
  it('syncs the end to the start plus expected play', () => {
    // Arrange & Act
    const { result } = renderHook(
      (props: HarnessProps) => useHarnessEnd(props),
      {
        initialProps: {
          endTouched: false,
          mode: 'test',
          questionCount: 0,
          scheduledStart: START_WALL_CLOCK,
          timePerQuestionSeconds: 10,
        },
      }
    );

    // Assert: 60s floor on a minute-aligned start lands one minute out.
    expect(result.current).toBe(
      quizInstantToDatetimeLocal(
        startInstantMs() + 60_000,
        QUIZ_DEFAULT_TIME_ZONE
      )
    );
  });

  it('rounds a sub-minute play window up so play fits inside it', () => {
    // Arrange & Act: two 35-second questions expect 70 seconds of play.
    const { result } = renderHook(
      (props: HarnessProps) => useHarnessEnd(props),
      {
        initialProps: {
          endTouched: false,
          mode: 'test',
          questionCount: 2,
          scheduledStart: START_WALL_CLOCK,
          timePerQuestionSeconds: 35,
        },
      }
    );

    // Assert: datetime-local drops seconds, so the end rounds up to 120s out.
    expect(result.current).toBe(
      quizInstantToDatetimeLocal(
        startInstantMs() + 120_000,
        QUIZ_DEFAULT_TIME_ZONE
      )
    );
  });

  it('leaves the end alone once the merchant edits it', () => {
    // Arrange & Act
    const { result } = renderHook(
      (props: HarnessProps) => useHarnessEnd(props),
      {
        initialProps: {
          endTouched: true,
          mode: 'test',
          questionCount: 2,
          scheduledStart: START_WALL_CLOCK,
          timePerQuestionSeconds: 35,
        },
      }
    );

    // Assert
    expect(result.current).toBe('preset');
  });
});
