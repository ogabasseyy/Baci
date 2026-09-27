import { getSuggestedQuizLiveWindowSeconds } from '@baci/shared';

export function suggestedQuizDuration(
  mode: 'test' | 'live',
  count: number,
  seconds: number
): number {
  return mode === 'live' && count > 0
    ? getSuggestedQuizLiveWindowSeconds(count, seconds)
    : Math.max(seconds, count * seconds);
}
