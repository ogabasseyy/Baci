'use client';

import type { QuizV2Event } from '@baci/shared/schemas';
import { useEffect, useState } from 'react';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';

type LoadedEvents = { events: QuizV2Event[]; userId: string };

/**
 * Loads the app-only Super Quiz events for the signed-in shopper. The listing
 * is caller-scoped (private test quizzes depend on tester/merchant access), so
 * results are bound to the user they were fetched for: after an account
 * switch nothing is shown until the new user's lookup completes. A failed
 * lookup degrades to the generic "play in the app" call to action.
 */
export function useAppQuizEvents(merchantSlug: string, userId: string | null) {
  const [loaded, setLoaded] = useState<LoadedEvents | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      let events: QuizV2Event[] = [];
      try {
        events = await fetchAppQuizEvents(merchantSlug);
      } catch {
        events = [];
      }
      if (!cancelled) setLoaded({ events, userId });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [merchantSlug, userId]);

  return userId && loaded?.userId === userId ? loaded.events : [];
}
