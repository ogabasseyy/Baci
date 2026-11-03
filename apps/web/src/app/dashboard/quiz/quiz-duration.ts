import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';

/**
 * Minimum suggested window for an immediate test launch. A window equal to
 * the bare play time (e.g. 20s for two 10-second questions) closes before the
 * merchant can even open the storefront app to rehearse it.
 */
export const QUIZ_TEST_MIN_SUGGESTED_WINDOW_SECONDS = 15 * 60;

export function suggestedQuizDuration(
  mode: 'test' | 'live',
  count: number,
  seconds: number
): number {
  if (mode === 'live') {
    return count > 0
      ? getSuggestedQuizLiveWindowSeconds(count, seconds)
      : Math.max(seconds, count * seconds);
  }
  return Math.max(
    QUIZ_TEST_MIN_SUGGESTED_WINDOW_SECONDS,
    seconds,
    count * seconds
  );
}
