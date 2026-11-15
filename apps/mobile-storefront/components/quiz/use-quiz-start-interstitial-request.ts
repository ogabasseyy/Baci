import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect } from 'react';
import type { AppState } from 'react-native';
import { isQuizRewardedFlowActive } from '@/lib/quiz-fullscreen-ownership';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { flushPendingQuizStart } from './quiz-pending-start';

// Minimum countdown remaining (at lobby open) for the pre-quiz interstitial.
// Below this the ad could eat into live play, so it is skipped.
const QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS = 30;

// How long the "ad break" notice covers the waiting room before the loaded
// interstitial is presented. Long enough to read and to lift a finger that
// was heading for a button; short enough not to feel like a second ad.
export const QUIZ_AD_BREAK_NOTICE_MS = 1_500;

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
 *
 * A loaded ad is never presented straight over the interactive waiting
 * room: the host first shows a non-interactive "ad break" notice for
 * QUIZ_AD_BREAK_NOTICE_MS (AdMob's accidental-click guidance), and the
 * cancellation checks run again when it ends.
 */
export function useQuizStartInterstitialRequest({
  appStateRef,
  getRemainingSeconds,
  isFullscreenAdActiveRef,
  isStartBlockedRef,
  onStartRef,
  pendingStartRef,
  setIsAdBreakNoticeVisible,
  setIsFullscreenAdActive,
  startedRef,
  stoppedRef,
  suspendedRef,
}: {
  appStateRef: MutableRefObject<typeof AppState.currentState>;
  getRemainingSeconds: () => number;
  isFullscreenAdActiveRef: MutableRefObject<boolean>;
  isStartBlockedRef: MutableRefObject<boolean>;
  onStartRef: MutableRefObject<(eventId: string, termsAccepted: true) => void>;
  pendingStartRef: MutableRefObject<QuizEvent | null>;
  setIsAdBreakNoticeVisible: Dispatch<SetStateAction<boolean>>;
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
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    let endNotice: (() => void) | null = null;
    // Ends a notice that is still counting down: on unmount, and when the
    // helper settles early (SDK error or load deadline while it is up), so
    // no timer outlives the request.
    const settleNotice = () => {
      if (noticeTimer !== null) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      const end = endNotice;
      endNotice = null;
      end?.();
    };
    if (getRemainingSeconds() > QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS) {
      void maybeShowQuizStartInterstitial({
        beforePresent: () =>
          new Promise<void>((resolve) => {
            if (!mounted) {
              resolve();
              return;
            }
            setIsAdBreakNoticeVisible(true);
            endNotice = resolve;
            noticeTimer = setTimeout(() => {
              noticeTimer = null;
              endNotice = null;
              resolve();
            }, QUIZ_AD_BREAK_NOTICE_MS);
          }),
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
          settleNotice();
          if (!mounted) return;
          isFullscreenAdActiveRef.current = false;
          setIsFullscreenAdActive(false);
          setIsAdBreakNoticeVisible(false);
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
        // take is atomic, and abandon paths hold nothing to flush). The
        // notice comes down too: an ad abandoned after it must not leave
        // the waiting room covered.
        settleNotice();
        isFullscreenAdActiveRef.current = false;
        setIsFullscreenAdActive(false);
        setIsAdBreakNoticeVisible(false);
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
      // Settle a notice still on screen so the helper re-checks, sees the
      // unmount and releases its reservation instead of waiting on a timer.
      settleNotice();
    };
  }, []);
}
