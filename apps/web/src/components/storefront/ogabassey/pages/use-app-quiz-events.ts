import type { QuizV2Event } from '@baci/shared/schemas';
import { useEffect, useState } from 'react';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';

export type AppQuizEventsStatus = 'idle' | 'loading' | 'ready' | 'error';

type Loaded = {
  events: QuizV2Event[];
  status: 'ready' | 'error';
  userId: string;
};

/**
 * Loads the app-only Super Quiz events for the signed-in shopper. The listing
 * is caller-scoped (private test quizzes depend on tester/merchant access), so
 * results are bound to the user they were fetched for: after an account
 * switch nothing is shown until the new user's lookup completes. A failed
 * lookup reports `error` (not an empty listing) and can be retried.
 */
export function useAppQuizEvents(merchantSlug: string, userId: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      let next: Loaded;
      try {
        const events = await fetchAppQuizEvents(merchantSlug);
        next = { events, status: 'ready', userId };
      } catch {
        next = { events: [], status: 'error', userId };
      }
      if (!cancelled) setLoaded(next);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt, merchantSlug, userId]);

  const current = userId && loaded?.userId === userId ? loaded : null;
  const status: AppQuizEventsStatus = !userId
    ? 'idle'
    : (current?.status ?? 'loading');
  return {
    events: current?.events ?? [],
    retry: () => {
      setLoaded(null);
      setAttempt((value) => value + 1);
    },
    status,
  };
}
