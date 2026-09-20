import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { resolveQuizAuthoringWindowSeconds } from './quiz-authoring-window-seconds';
import {
  quizDatetimeLocalToIso,
  quizInstantToDatetimeLocal,
} from './quiz-datetime-local';

const MINUTE_MS = 60_000;

/**
 * Auto-derived Universal end from the start plus the expected play time for
 * the given question count. All values are launch-policy-zone
 * (Africa/Lagos) wall clocks: activation interprets the inputs in that
 * zone, so browser-local math would shift the window for admins elsewhere.
 * Rounds up to minute precision because datetime-local inputs drop seconds
 * — a 70-second play window must not sync an end only 60 seconds out.
 * Returns null when the start is unparseable.
 */
export function resyncQuizAuthoringScheduledEnd({
  mode,
  questionCount,
  scheduledStart,
  timePerQuestionSeconds,
}: {
  mode: 'test' | 'live';
  questionCount: number;
  scheduledStart: string;
  timePerQuestionSeconds: number;
}): string | null {
  const expectedPlaySeconds = resolveQuizAuthoringWindowSeconds({
    mode,
    questionCount,
    timePerQuestionSeconds,
  });
  const startIso = quizDatetimeLocalToIso(
    scheduledStart,
    QUIZ_DEFAULT_TIME_ZONE
  );
  const startMs = startIso ? Date.parse(startIso) : Number.NaN;
  if (!Number.isFinite(startMs)) return null;
  const syncedEndMs =
    Math.ceil((startMs + expectedPlaySeconds * 1000) / MINUTE_MS) * MINUTE_MS;
  return quizInstantToDatetimeLocal(syncedEndMs, QUIZ_DEFAULT_TIME_ZONE);
}
