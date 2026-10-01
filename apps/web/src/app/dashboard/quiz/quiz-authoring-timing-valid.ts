import { quizAuthoringIntervalMs } from './quiz-authoring-interval';

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
