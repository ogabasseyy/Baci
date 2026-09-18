import {
  getSuggestedQuizLiveWindowSeconds,
  isQuizWindowSecondsAllowed,
  QUIZ_DEFAULT_TIME_ZONE,
  type QuizMode,
} from '@baci/shared';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import {
  quizDatetimeLocalToIso,
  quizInstantToDatetimeLocal,
} from './quiz-datetime-local';

const MINUTE_MS = 60_000;

const SCHEDULE_START_LEAD_MS = 3_600_000;
const SCHEDULE_END_LEAD_MS = 3_900_000;

/**
 * Default schedule inputs in the launch policy zone: activation interprets
 * these wall clocks as Africa/Lagos, so browser-local defaults would shift
 * the window for admins elsewhere. The default end sits 5 minutes after the
 * default start.
 */
export function defaultQuizAuthoringSchedule(nowMs: number): {
  scheduledEnd: string;
  scheduledStart: string;
} {
  return {
    scheduledEnd:
      quizInstantToDatetimeLocal(
        nowMs + SCHEDULE_END_LEAD_MS,
        QUIZ_DEFAULT_TIME_ZONE
      ) ?? '',
    scheduledStart:
      quizInstantToDatetimeLocal(
        nowMs + SCHEDULE_START_LEAD_MS,
        QUIZ_DEFAULT_TIME_ZONE
      ) ?? '',
  };
}

/**
 * Preview text for when the quiz closes. Scheduled quizzes show the
 * launch-policy-zone end interpreted in that same zone so the preview
 * matches what activation will schedule; immediate launches show the live
 * window length instead.
 */
export function resolveQuizAuthoringClosesAt({
  scheduledEnd,
  timingKind,
  windowMinutes,
}: {
  scheduledEnd: string;
  timingKind: 'immediate' | 'scheduled';
  windowMinutes: string;
}): string {
  if (timingKind === 'scheduled' && scheduledEnd) {
    return new Date(
      quizDatetimeLocalToIso(scheduledEnd, QUIZ_DEFAULT_TIME_ZONE) ?? Number.NaN
    ).toLocaleString();
  }
  return `About ${windowMinutes} minute${windowMinutes === '1' ? '' : 's'} after launch`;
}

/**
 * Schedule input state with launch-policy-zone defaults. The admin owns the
 * Universal end once they edit it; until then it tracks the start via
 * useQuizAuthoringWindowSync.
 */
export function useQuizAuthoringSchedule(nowMs: number): {
  scheduledEnd: string;
  scheduledStart: string;
  setScheduledEnd: Dispatch<SetStateAction<string>>;
  setScheduledStart: Dispatch<SetStateAction<string>>;
} {
  const [scheduleDefaults] = useState(() =>
    defaultQuizAuthoringSchedule(nowMs)
  );
  const [scheduledStart, setScheduledStart] = useState(
    scheduleDefaults.scheduledStart
  );
  const [scheduledEnd, setScheduledEnd] = useState(
    scheduleDefaults.scheduledEnd
  );
  return { scheduledEnd, scheduledStart, setScheduledEnd, setScheduledStart };
}

/**
 * Validate launch timing. Scheduled quizzes compare the zoned ISO
 * conversions of the inputs (as activation does), not Date.parse, which
 * would read the wall clocks in the admin browser's zone and misjudge
 * DST-gap intervals.
 */
export function isQuizAuthoringTimingValid({
  scheduledEnd,
  scheduledStart,
  timingKind,
}: {
  scheduledEnd: string;
  scheduledStart: string;
  timingKind: 'immediate' | 'scheduled';
}): boolean {
  if (timingKind === 'immediate') return true;
  const interval = quizAuthoringIntervalMs(scheduledStart, scheduledEnd);
  return interval !== null && interval.endMs > interval.startMs;
}

/**
 * Gate draft generation on the activation timing bounds, not just interval
 * order. The auto-sync keeps the defaulted end inside the bounds, but a
 * manual end edit can shrink the window below what activation accepts
 * (e.g. a one-minute window for a 20-question quiz), which would waste the
 * AI draft request on a quiz that can never launch.
 */
export function isQuizAuthoringWindowAllowed({
  mode,
  questionCount,
  scheduledEnd,
  scheduledStart,
  timePerQuestionSeconds,
  timingKind,
}: {
  mode: QuizMode;
  questionCount: number;
  scheduledEnd: string;
  scheduledStart: string;
  timePerQuestionSeconds: number;
  timingKind: 'immediate' | 'scheduled';
}): boolean {
  if (timingKind === 'immediate') return true;
  const interval = quizAuthoringIntervalMs(scheduledStart, scheduledEnd);
  if (interval === null || interval.endMs <= interval.startMs) return false;
  const windowSeconds = (interval.endMs - interval.startMs) / 1000;
  return isQuizWindowSecondsAllowed(
    mode,
    questionCount,
    timePerQuestionSeconds,
    windowSeconds
  );
}

function quizAuthoringIntervalMs(
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

interface QuizAuthoringWindowSyncInput {
  endTouched: boolean;
  mode: 'test' | 'live';
  questionCount: number;
  scheduledStart: string;
  setScheduledEnd: (updater: (current: string) => string) => void;
  timePerQuestionSeconds: number;
}

/**
 * Resolve the auto-synced quiz window length in seconds. Live mode tracks
 * the shared suggested live window (expected play plus the documented
 * grace, whole minutes) so activation satisfies the launch timing bounds.
 * Other modes use raw expected play with a floor that keeps the defaulted
 * end after the start when no questions exist yet.
 */
export function resolveQuizAuthoringWindowSeconds({
  mode,
  questionCount,
  timePerQuestionSeconds,
}: Pick<
  QuizAuthoringWindowSyncInput,
  'mode' | 'questionCount' | 'timePerQuestionSeconds'
>): number {
  if (mode === 'live' && questionCount > 0) {
    return getSuggestedQuizLiveWindowSeconds(
      questionCount,
      timePerQuestionSeconds
    );
  }
  return Math.max(questionCount * timePerQuestionSeconds, 60);
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
