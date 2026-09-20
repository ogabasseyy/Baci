import { isQuizWindowSecondsAllowed, type QuizMode } from '@baci/shared';
import { quizAuthoringIntervalMs } from './quiz-authoring-interval';

/**
 * Gate draft generation on the activation timing bounds, not just interval
 * order. The auto-sync keeps the defaulted end inside the bounds, but a
 * manual end edit can shrink the window below what activation accepts
 * (e.g. a one-minute window for a 20-question quiz), which would waste the
 * AI draft request on a quiz that can never launch. Scheduled starts must
 * also still be in the future: quiz-launch-v2 rejects starts at or before
 * now, so a page left open past its start disables generation.
 */
export function isQuizAuthoringWindowAllowed({
  liveWindowMinutes,
  mode,
  nowMs = Date.now(),
  questionCount,
  scheduledEnd,
  scheduledStart,
  timePerQuestionSeconds,
  timingKind,
}: {
  liveWindowMinutes: number;
  mode: QuizMode;
  nowMs?: number;
  questionCount: number;
  scheduledEnd: string;
  scheduledStart: string;
  timePerQuestionSeconds: number;
  timingKind: 'immediate' | 'scheduled';
}): boolean {
  if (timingKind === 'immediate') {
    return isQuizWindowSecondsAllowed(
      mode,
      questionCount,
      timePerQuestionSeconds,
      liveWindowMinutes * 60
    );
  }
  const interval = quizAuthoringIntervalMs(scheduledStart, scheduledEnd);
  if (interval === null || interval.endMs <= interval.startMs) return false;
  if (interval.startMs <= nowMs) return false;
  const windowSeconds = (interval.endMs - interval.startMs) / 1000;
  return isQuizWindowSecondsAllowed(
    mode,
    questionCount,
    timePerQuestionSeconds,
    windowSeconds
  );
}
