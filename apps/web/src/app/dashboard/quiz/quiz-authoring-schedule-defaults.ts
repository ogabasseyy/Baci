import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { quizInstantToDatetimeLocal } from './quiz-datetime-local';

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
