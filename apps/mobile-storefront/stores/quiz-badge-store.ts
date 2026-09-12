import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorage as AsyncStorage } from '@/lib/storage';
import { mergeQuizBadgeMaps } from './quiz-badge-map';
import type { QuizBadge } from './quiz-badge-store-types';

export type { QuizBadge, QuizBadgeMap } from './quiz-badge-store-types';

interface QuizBadgeState {
  badgesByUser: Record<string, Record<string, QuizBadge>>;
  getBadge: (userId: string, eventId: string) => QuizBadge | null;
  getMostRecentBadge: (userId: string) => QuizBadge | null;
  unlockBadge: (
    userId: string,
    eventId: string,
    eventTitle: string,
    unlockedAt?: number
  ) => void;
}

export const useQuizBadgeStore = create<QuizBadgeState>()(
  persist(
    (set, get) => ({
      badgesByUser: {},
      getBadge: (userId, eventId) =>
        get().badgesByUser[userId]?.[eventId] ?? null,
      getMostRecentBadge: (userId) => {
        const badges = Object.values(get().badgesByUser[userId] ?? {});
        return badges.sort((a, b) => b.unlockedAt - a.unlockedAt)[0] ?? null;
      },
      unlockBadge: (userId, eventId, eventTitle, unlockedAt = Date.now()) => {
        if (!userId || !eventId) return;
        set((state) => ({
          badgesByUser: {
            ...state.badgesByUser,
            [userId]: {
              ...state.badgesByUser[userId],
              [eventId]: {
                eventId,
                eventTitle,
                label: 'SuperQuiz badge',
                unlockedAt,
              },
            },
          },
        }));
      },
    }),
    {
      name: 'quiz-badge-storage',
      merge: (persistedState, currentState) => {
        const persistedBadges =
          (persistedState as Partial<QuizBadgeState> | undefined)
            ?.badgesByUser ?? {};
        return {
          ...currentState,
          badgesByUser: mergeQuizBadgeMaps(
            currentState.badgesByUser,
            persistedBadges
          ),
        };
      },
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
