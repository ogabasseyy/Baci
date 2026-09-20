import type { MutableRefObject } from 'react';
import { useEffect } from 'react';
import type { AppStateStatus } from 'react-native';
import type { QuizEvent } from '@/services/quiz-types';
import { flushPendingQuizStart } from './quiz-pending-start';

/**
 * Holds a quiz start boundary behind a covering surface: an open rewarded
 * video/end card or the rules modal. The waiting-room hook routes
 * boundaries into the pending-start path while the combined flag is set;
 * this effect flushes the hold when it clears. If the interstitial still
 * owns the screen its onClosed handler flushes instead.
 */
export function useQuizStartHold({
  appStateRef,
  isFullscreenAdActiveRef,
  isStartBlocked,
  isStartBlockedRef,
  onStartRef,
  pendingStartRef,
  startedRef,
  stoppedRef,
}: {
  appStateRef: MutableRefObject<AppStateStatus>;
  isFullscreenAdActiveRef: MutableRefObject<boolean>;
  isStartBlocked: boolean;
  isStartBlockedRef: MutableRefObject<boolean>;
  onStartRef: MutableRefObject<(eventId: string, termsAccepted: true) => void>;
  pendingStartRef: MutableRefObject<QuizEvent | null>;
  startedRef: MutableRefObject<boolean>;
  stoppedRef: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    const wasBlocked = isStartBlockedRef.current;
    isStartBlockedRef.current = isStartBlocked;
    if (
      wasBlocked &&
      !isStartBlocked &&
      !isFullscreenAdActiveRef.current &&
      appStateRef.current === 'active'
    ) {
      flushPendingQuizStart({
        onStartRef,
        pendingStartRef,
        startedRef,
        stoppedRef,
      });
    }
  }, [isStartBlocked]);
}
