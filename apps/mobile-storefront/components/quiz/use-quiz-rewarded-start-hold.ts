import type { MutableRefObject } from 'react';
import { useEffect } from 'react';
import type { AppStateStatus } from 'react-native';
import type { QuizEvent } from '@/services/quiz-types';
import { flushPendingQuizStart } from './quiz-pending-start';

/**
 * Holds a quiz start boundary behind an open rewarded video or end card.
 * The waiting-room hook routes boundaries into the pending-start path while
 * the flag is set; this effect flushes the hold when the rewarded ad
 * closes. If the interstitial still owns the screen its onClosed handler
 * flushes instead.
 */
export function useQuizRewardedStartHold({
  appStateRef,
  isFullscreenAdActiveRef,
  isRewardedAdActive,
  isRewardedAdActiveRef,
  onStartRef,
  pendingStartRef,
  startedRef,
  stoppedRef,
}: {
  appStateRef: MutableRefObject<AppStateStatus>;
  isFullscreenAdActiveRef: MutableRefObject<boolean>;
  isRewardedAdActive: boolean;
  isRewardedAdActiveRef: MutableRefObject<boolean>;
  onStartRef: MutableRefObject<(eventId: string, termsAccepted: true) => void>;
  pendingStartRef: MutableRefObject<QuizEvent | null>;
  startedRef: MutableRefObject<boolean>;
  stoppedRef: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    const wasActive = isRewardedAdActiveRef.current;
    isRewardedAdActiveRef.current = isRewardedAdActive;
    if (
      wasActive &&
      !isRewardedAdActive &&
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
  }, [isRewardedAdActive]);
}
