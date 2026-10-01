import type { MutableRefObject } from 'react';
import type { QuizEvent } from '@/services/quiz-types';

/**
 * Starts timed play from a held start boundary. Callers decide WHEN a flush
 * is allowed (interstitial closed, rewarded flag cleared, app active); this
 * primitive only performs the single atomic take-and-start so the two flush
 * sites cannot diverge.
 */
export function flushPendingQuizStart({
  onStartRef,
  pendingStartRef,
  startedRef,
  stoppedRef,
}: {
  onStartRef: MutableRefObject<(eventId: string, termsAccepted: true) => void>;
  pendingStartRef: MutableRefObject<QuizEvent | null>;
  startedRef: MutableRefObject<boolean>;
  stoppedRef: MutableRefObject<boolean>;
}): void {
  const pendingStart = pendingStartRef.current;
  pendingStartRef.current = null;
  if (pendingStart && !startedRef.current && !stoppedRef.current) {
    startedRef.current = true;
    onStartRef.current(pendingStart.id, true);
  }
}
