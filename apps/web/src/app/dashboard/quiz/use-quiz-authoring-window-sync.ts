import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { useEffect } from 'react';
import { resolveQuizAuthoringWindowSeconds } from './quiz-authoring-window-seconds';
import {
  quizDatetimeLocalToIso,
  quizInstantToDatetimeLocal,
} from './quiz-datetime-local';

const MINUTE_MS = 60_000;

export interface QuizAuthoringWindowSyncInput {
  endTouched: boolean;
  mode: 'test' | 'live';
  questionCount: number;
  scheduledStart: string;
  setScheduledEnd: (updater: (current: string) => string) => void;
  timePerQuestionSeconds: number;
}

/**
 * Keep the Universal end synced to the start until the merchant edits it.
 * All values are launch-policy-zone (Africa/Lagos) wall clocks: activation
 * interprets the inputs in that zone, so browser-local defaults would shift
 * the window for admins elsewhere. Rounds the synced end up to minute
 * precision because datetime-local inputs drop seconds — a 70-second play
 * window must not sync an end only 60 seconds out.
 */
export function useQuizAuthoringWindowSync({
  endTouched,
  mode,
  questionCount,
  scheduledStart,
  setScheduledEnd,
  timePerQuestionSeconds,
}: QuizAuthoringWindowSyncInput): void {
  const expectedPlaySeconds = resolveQuizAuthoringWindowSeconds({
    mode,
    questionCount,
    timePerQuestionSeconds,
  });
  useEffect(() => {
    if (endTouched) return;
    const startIso = quizDatetimeLocalToIso(
      scheduledStart,
      QUIZ_DEFAULT_TIME_ZONE
    );
    const startMs = startIso ? Date.parse(startIso) : Number.NaN;
    if (!Number.isFinite(startMs)) return;
    const syncedEndMs =
      Math.ceil((startMs + expectedPlaySeconds * 1000) / MINUTE_MS) * MINUTE_MS;
    const synced = quizInstantToDatetimeLocal(
      syncedEndMs,
      QUIZ_DEFAULT_TIME_ZONE
    );
    if (!synced) return;
    setScheduledEnd((current) => (current === synced ? current : synced));
  }, [endTouched, expectedPlaySeconds, scheduledStart, setScheduledEnd]);
}
