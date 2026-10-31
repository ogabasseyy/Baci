'use client';

import type { QuizV2Event } from '@baci/shared/schemas';
import { useEffect, useState } from 'react';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';

/**
 * Loads the app-only Super Quiz events once the shopper is signed in (the
 * listing is customer-scoped). A failed lookup degrades to the generic
 * "play in the app" call to action instead of an error on the page.
 */
export function useAppQuizEvents(merchantSlug: string, enabled: boolean) {
  const [events, setEvents] = useState<QuizV2Event[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      let next: QuizV2Event[] = [];
      try {
        next = await fetchAppQuizEvents(merchantSlug);
      } catch {
        next = [];
      }
      if (!cancelled) setEvents(next);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, merchantSlug]);

  return enabled ? events : [];
}
