import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { fetchQuizEvents } from '@/services/quiz';
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
  enabled: boolean,
  maxAttempts: number | undefined
): number | null {
  const [attemptsUsed, setAttemptsUsed] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !eventId) {
      setAttemptsUsed(null);
      return;
    }
    let active = true;
    fetchQuizEvents()
      .then((events) => {
        if (!active) return;
        const used = events.find((event) => event.id === eventId)?.attemptsUsed;
        setAttemptsUsed(typeof used === 'number' ? used : null);
      })
      .catch((error) => {
        log.warn('Failed to refresh quiz attempts', error);
        if (active) setAttemptsUsed(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, eventId]);

  return getQuizTriesLeft({
    attemptsUsed: attemptsUsed ?? undefined,
    maxAttempts,
  });
}
