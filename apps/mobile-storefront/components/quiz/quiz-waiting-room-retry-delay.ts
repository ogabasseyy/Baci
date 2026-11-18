import { backoffDelay } from './quiz-backoff-delay';
import { isOverloadError } from './quiz-is-overload-error';
import type { RandomSource } from './quiz-with-spread';

const WAITING_ROOM_RETRY_BASE_MS = 1_000;
const WAITING_ROOM_RETRY_CAP_MS = 5_000;

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
