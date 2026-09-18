import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';
import { useEffect } from 'react';

const MINUTE_MS = 60_000;

export function localDatetime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
 * Rounds the synced end up to minute precision because datetime-local
 * inputs drop seconds — a 70-second play window must not sync an end only
 * 60 seconds out.
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
    const startMs = Date.parse(scheduledStart);
    if (!Number.isFinite(startMs)) return;
    const syncedEndMs =
      Math.ceil((startMs + expectedPlaySeconds * 1000) / MINUTE_MS) * MINUTE_MS;
    const synced = localDatetime(new Date(syncedEndMs));
    setScheduledEnd((current) => (current === synced ? current : synced));
  }, [endTouched, expectedPlaySeconds, scheduledStart, setScheduledEnd]);
}
