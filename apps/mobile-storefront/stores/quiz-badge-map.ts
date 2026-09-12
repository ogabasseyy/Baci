import type { QuizBadge, QuizBadgeMap } from './quiz-badge-store-types';

export function mergeQuizBadgeMaps(
  current: QuizBadgeMap,
  persisted: QuizBadgeMap
): QuizBadgeMap {
  const merged: QuizBadgeMap = { ...current };
  for (const [userId, persistedBadges] of Object.entries(persisted)) {
    merged[userId] = { ...merged[userId] };
    for (const [eventId, persistedBadge] of Object.entries(persistedBadges)) {
      const currentBadge = merged[userId][eventId];
      merged[userId][eventId] =
        currentBadge && currentBadge.unlockedAt >= persistedBadge.unlockedAt
          ? currentBadge
          : persistedBadge;
    }
  }
  return merged;
}

export type { QuizBadge, QuizBadgeMap };
