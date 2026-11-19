import { backoffDelay } from './quiz-backoff-delay';
import { isOverloadError } from './quiz-is-overload-error';
import type { RandomSource } from './quiz-with-spread';

const WAITING_ROOM_RETRY_BASE_MS = 1_000;
const WAITING_ROOM_RETRY_CAP_MS = 5_000;

/**
 * Window over which phones spread their first status check once the
 * countdown reaches zero. Each player's quiz clock starts when their own
 * attempt starts, so a later check costs a short wait, never quiz time.
 */
export const WAITING_ROOM_KICKOFF_SPREAD_MS = 3_000;

/**
 * Waiting-room refresh retry: 1, 2, 4 then 5 s (with spread), and 5 to 7 s
 * once the server has said it is rate limiting or overloaded.
 */
export function waitingRoomRetryDelay(
  failures: number,
  error: unknown,
  random: RandomSource = Math.random
): number {
  return backoffDelay({
    baseMs: WAITING_ROOM_RETRY_BASE_MS,
    failures,
    capMs: WAITING_ROOM_RETRY_CAP_MS,
    floorMs: isOverloadError(error) ? WAITING_ROOM_RETRY_CAP_MS : 0,
    random,
  });
}

/**
 * Gap before asking again after the server answered but the quiz is still
 * scheduled: 1, 2, 4 then 5 s (with spread). A late activation must not keep
 * every waiting phone asking once a second.
 */
export function waitingRoomPendingDelay(
  pendingAnswers: number,
  random: RandomSource = Math.random
): number {
  return backoffDelay({
    baseMs: WAITING_ROOM_RETRY_BASE_MS,
    failures: pendingAnswers,
    capMs: WAITING_ROOM_RETRY_CAP_MS,
    random,
  });
}
