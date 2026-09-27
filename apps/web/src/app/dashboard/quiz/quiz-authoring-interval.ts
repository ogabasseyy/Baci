import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { quizDatetimeLocalToIso } from './quiz-datetime-local';

/**
 * Zoned schedule interval in epoch milliseconds, converted the way
 * activation interprets the inputs (Africa/Lagos wall clocks). Returns null
 * when either input is empty or unparseable.
 */
export function quizAuthoringIntervalMs(
  scheduledStart: string,
  scheduledEnd: string
): { endMs: number; startMs: number } | null {
  const scheduledStartIso = scheduledStart
    ? quizDatetimeLocalToIso(scheduledStart, QUIZ_DEFAULT_TIME_ZONE)
    : null;
  const scheduledEndIso = scheduledEnd
    ? quizDatetimeLocalToIso(scheduledEnd, QUIZ_DEFAULT_TIME_ZONE)
    : null;
  const startMs = scheduledStartIso
    ? Date.parse(scheduledStartIso)
    : Number.NaN;
  const endMs = scheduledEndIso ? Date.parse(scheduledEndIso) : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { endMs, startMs };
}
