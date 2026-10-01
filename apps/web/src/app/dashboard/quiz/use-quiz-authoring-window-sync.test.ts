import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  quizDatetimeLocalToIso,
  quizInstantToDatetimeLocal,
} from './quiz-datetime-local';
import { useQuizAuthoringWindowSync } from './use-quiz-authoring-window-sync';

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
