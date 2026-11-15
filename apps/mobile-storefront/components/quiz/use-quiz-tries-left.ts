import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { fetchQuizEvents } from '@/services/quiz';
import type { QuizEvent } from '@/services/quiz-types';
import { getQuizTriesLeft } from './QuizScreen.utils';

const log = createLogger('QuizTriesLeft');

/**
 * Tries left for an event, read from a fresh events fetch. The lobby list is
 * loaded before the attempt starts, so its count is stale on the result
 * screen. Returns null until the fresh count arrives (or if it cannot be
 * fetched), which keeps the plain "Play again" label.
 */
export function useQuizTriesLeft(
  eventId: string | null | undefined,
  enabled: boolean
): number | null {
  const [fresh, setFresh] = useState<Pick<
    QuizEvent,
    'attemptsUsed' | 'maxAttempts'
  > | null>(null);

  useEffect(() => {
    if (!enabled || !eventId) {
      setFresh(null);
      return;
    }
    let active = true;
    fetchQuizEvents({ stopAtEventId: eventId })
      .then((events) => {
        if (!active) return;
        // Both numbers come from the same fresh payload, never the cached list.
        setFresh(events.find((event) => event.id === eventId) ?? null);
      })
      .catch((error) => {
        log.warn('Failed to refresh quiz attempts', error);
        if (active) setFresh(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, eventId]);

  return getQuizTriesLeft(fresh ?? undefined);
}
