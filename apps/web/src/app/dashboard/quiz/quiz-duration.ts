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

export function formatQuizDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${remainder}s`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
