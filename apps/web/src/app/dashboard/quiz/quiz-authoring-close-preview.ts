import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { quizDatetimeLocalToIso } from './quiz-datetime-local';

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
    // Format in the policy zone, not the admin browser's zone: a Lagos
    // 10:05 end must preview as 10:05 in New York too, or the summary
    // contradicts the form and invites incorrect schedule edits.
    return new Date(
      quizDatetimeLocalToIso(scheduledEnd, QUIZ_DEFAULT_TIME_ZONE) ?? Number.NaN
    ).toLocaleString(undefined, { timeZone: QUIZ_DEFAULT_TIME_ZONE });
  }
  return `About ${windowMinutes} minute${windowMinutes === '1' ? '' : 's'} after launch`;
}
