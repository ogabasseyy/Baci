import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect } from 'react';
import type { AppStateStatus } from 'react-native';
import { isQuizRewardedFlowActive } from '@/lib/quiz-fullscreen-ownership';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { flushPendingQuizStart } from './quiz-pending-start';

// Minimum countdown remaining (at lobby open) for the pre-quiz interstitial.
// Below this the ad could eat into live play, so it is skipped.
const QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS = 30;

/**
 * Requests the pre-quiz interstitial once at lobby open and owns the
 * fullscreen-ownership flag through presentation, close, and failure.
 * Fire-and-forget: the lobby countdown keeps ticking underneath and play
 * never waits on the ad. The load is abandoned if the shopper moves into
 * live play, the lobby unmounts, the rules modal suspends the lobby, or
 * the countdown reaches the safety margin while the load is in flight. The
 * request requires strictly more than 30 seconds, so presentation cancels
 * at 30 or below: a whole "30" on screen can be as little as 29.001 real
 * seconds.
 */
export function useQuizStartInterstitialRequest({
  appStateRef,
  getRemainingSeconds,
  isFullscreenAdActiveRef,
  isStartBlockedRef,
  onStartRef,
  pendingStartRef,
  setIsFullscreenAdActive,
  startedRef,
  stoppedRef,
  suspendedRef,
}: {
  appStateRef: MutableRefObject<AppStateStatus>;
  getRemainingSeconds: () => number;
  isFullscreenAdActiveRef: MutableRefObject<boolean>;
  isStartBlockedRef: MutableRefObject<boolean>;
  onStartRef: MutableRefObject<(eventId: string, termsAccepted: true) => void>;
  pendingStartRef: MutableRefObject<QuizEvent | null>;
  setIsFullscreenAdActive: Dispatch<SetStateAction<boolean>>;
  startedRef: MutableRefObject<boolean>;
  stoppedRef: MutableRefObject<boolean>;
  suspendedRef: MutableRefObject<boolean>;
}): void {
  // The lobby-open request fires once; live state flows through refs and
  // the remaining-seconds reader so the closure never goes stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lobby-open request fires once by design
  useEffect(() => {
    let mounted = true;
    if (getRemainingSeconds() > QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS) {
      void maybeShowQuizStartInterstitial({
        isCancelled: () =>
          !mounted ||
          startedRef.current ||
          stoppedRef.current ||
          suspendedRef.current ||
          // A backgrounded app must never present on LOADED: the ad would
          // surface only when the shopper resumes, over whatever they see.
          // Mirrors the waiting-room countdown tick guard: only
          // background/inactive cancel, so transient states never abandon
          // the load.
          appStateRef.current === 'background' ||
          appStateRef.current === 'inactive' ||
          getRemainingSeconds() <=
            QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS,
        onClosed: () => {
          if (!mounted) return;
          isFullscreenAdActiveRef.current = false;
          setIsFullscreenAdActive(false);
          // A native dismissal while the app is inactive must not start
          // timed play in the background: retain the pending transition
          // until the foreground refresh re-validates it on resume.
          if (appStateRef.current !== 'active') return;
          // Likewise while a rewarded ad or the rules modal covers the
          // lobby: the hold hook flushes when the covering flag clears.
          // The rewarded prop lags the tap by a passive effect, so read
          // the synchronously claimed ownership too.
          if (isStartBlockedRef.current || isQuizRewardedFlowActive()) return;
          flushPendingQuizStart({
            onStartRef,
            pendingStartRef,
            startedRef,
            stoppedRef,
          });
        },
        onPresenting: () => {
          // show() resolves over a native bridge round-trip after
          // presentation begins; claim ownership synchronously here so a
          // start refresh completing in that window holds instead of
          // starting timed play behind the presenting ad.
          if (!mounted) return;
          isFullscreenAdActiveRef.current = true;
          setIsFullscreenAdActive(true);
        },
      }).then((outcome) => {
        if (!mounted) return;
        if (outcome === 'shown') {
          isFullscreenAdActiveRef.current = true;
          setIsFullscreenAdActive(true);
          return;
        }
        // A failed presentation never produces CLOSED: no dismissal will
        // clear the synchronously claimed ownership, so release it here
        // and flush a boundary held in the window (mirrors onClosed; the
        // take is atomic, and abandon paths hold nothing to flush).
        isFullscreenAdActiveRef.current = false;
        setIsFullscreenAdActive(false);
        if (appStateRef.current !== 'active') return;
        if (isStartBlockedRef.current || isQuizRewardedFlowActive()) return;
        flushPendingQuizStart({
          onStartRef,
          pendingStartRef,
          startedRef,
          stoppedRef,
        });
      });
    }
    return () => {
      mounted = false;
    };
  }, []);
}
