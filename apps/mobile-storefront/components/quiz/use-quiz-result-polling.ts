import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizEventBackendMode, QuizV2Result } from '@/services/quiz-types';
import { backoffDelay } from './quiz-backoff-delay';
import { isOverloadError } from './quiz-is-overload-error';
import { randomDelay } from './quiz-random-delay';
import { withSpread } from './quiz-with-spread';
import { useQuizResultRealtimeWakeup } from './use-quiz-result-realtime-wakeup';

export const QUIZ_RESULT_POLL_INTERVAL_MS = 5_000;
export const QUIZ_RESULT_POLL_MAX_INTERVAL_MS = 30_000;
export const QUIZ_RESULT_POST_DEADLINE_FALLBACK_MIN_MS = 8_000;
const QUIZ_RESULT_POST_DEADLINE_FALLBACK_JITTER_MS = 4_000;
// Spread of the realtime "results ready" wake-up so thousands of phones do
// not all poll in the same instant.
export const QUIZ_RESULT_WAKEUP_MAX_DELAY_MS = 4_000;
const QUIZ_RESULT_OVERLOAD_RETRY_FLOOR_MS = 15_000;

function getStableFallbackDelayMs(attemptId: string): number {
  let hash = 0;
  for (const character of attemptId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (
    QUIZ_RESULT_POST_DEADLINE_FALLBACK_MIN_MS +
    (hash % QUIZ_RESULT_POST_DEADLINE_FALLBACK_JITTER_MS)
  );
}

function getPendingPollDelayMs(
  availableAt: string | null,
  attemptId: string,
  nowMs = Date.now()
): number {
  const availableAtMs = availableAt ? Date.parse(availableAt) : Number.NaN;
  if (Number.isFinite(availableAtMs) && availableAtMs > nowMs) {
    // availableAt is server time while nowMs is device time. A device clock
    // that is behind can otherwise sleep this hook for hours and miss the
    // publication. Realtime normally wakes us sooner; this cap is the safe
    // HTTP fallback when that channel is unavailable.
    const waitMs = availableAtMs - nowMs;
    if (waitMs >= QUIZ_RESULT_POLL_MAX_INTERVAL_MS) {
      // Spread (+/- 20%) so phones that finished together do not keep
      // polling in step every 30 s until the event ends.
      return withSpread(QUIZ_RESULT_POLL_MAX_INTERVAL_MS);
    }
    // availableAt is the event end: the same instant for every player. Spread
    // this poll like the wake-up so the phones do not all ask at once. The
    // spread is added after the cap check, so the wait can be up to 4 s over
    // the cap; the cap is there to stop an hours-long sleep, not as a ceiling.
    return waitMs + randomDelay(QUIZ_RESULT_WAKEUP_MAX_DELAY_MS);
  }
  if (Number.isFinite(availableAtMs)) {
    return getStableFallbackDelayMs(attemptId);
  }
  // No time given: same slow fallback, spread for the same reason.
  return withSpread(QUIZ_RESULT_POLL_MAX_INTERVAL_MS);
}

// 5 s doubling to 30 s, with +/- 20% spread so phones that failed the same
// request do not all retry in the same instant, and never sooner than 15 s
// once the server has said it is rate limiting or overloaded.
function getFailedPollDelayMs(
  consecutiveFailures: number,
  error: unknown
): number {
  return backoffDelay({
    baseMs: QUIZ_RESULT_POLL_INTERVAL_MS,
    failures: consecutiveFailures,
    capMs: QUIZ_RESULT_POLL_MAX_INTERVAL_MS,
    floorMs: isOverloadError(error) ? QUIZ_RESULT_OVERLOAD_RETRY_FLOOR_MS : 0,
  });
}

export function useQuizResultPolling({
  attemptId,
  backendMode = 'postgres',
  enabled,
  eventId,
  expectedUserId,
  getCurrentUserId,
  onResult,
}: {
  attemptId: string | null;
  backendMode?: QuizEventBackendMode;
  enabled: boolean;
  eventId: string | null;
  expectedUserId: string | null;
  getCurrentUserId?: () => string | null;
  onResult: (result: QuizV2Result) => void;
}) {
  const currentUserIdRef = useRef(getCurrentUserId);
  const pollNowRef = useRef<() => void>(() => undefined);
  currentUserIdRef.current = getCurrentUserId;
  useQuizResultRealtimeWakeup({
    enabled:
      enabled &&
      backendMode !== 'edge_rooms' &&
      Boolean(attemptId && expectedUserId),
    eventId,
    onWakeup: () => pollNowRef.current(),
  });

  useEffect(() => {
    if (!enabled || !attemptId || !expectedUserId) return;

    let cancelled = false;
    let inFlight = false;
    let resumeAfterFlight = false;
    let consecutiveFailures = 0;
    let appIsActive =
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive';
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let wakeupId: ReturnType<typeof setTimeout> | undefined;
    const clearWakeup = () => {
      if (wakeupId) clearTimeout(wakeupId);
      wakeupId = undefined;
    };

    const schedule = (delayMs = QUIZ_RESULT_POLL_INTERVAL_MS) => {
      if (cancelled || !appIsActive) return;
      timeoutId = setTimeout(poll, delayMs);
    };
    const poll = async () => {
      if (cancelled || !appIsActive || inFlight) return;
      // This request already answers a pending "results ready" wake-up, so
      // the delayed wake-up poll must not send a second one behind it.
      clearWakeup();
      inFlight = true;
      let shouldContinue = false;
      let nextDelayMs = QUIZ_RESULT_POLL_INTERVAL_MS;
      try {
        const result = await fetchQuizResult({ attemptId, expectedUserId });
        consecutiveFailures = 0;
        const isPendingEdgeMaterialization =
          backendMode === 'edge_rooms' &&
          result.availability === 'unavailable' &&
          result.reason === 'not_found';
        if (result.availability === 'pending' || isPendingEdgeMaterialization) {
          shouldContinue = true;
          nextDelayMs = getPendingPollDelayMs(
            result.availability === 'pending' ? result.availableAt : null,
            attemptId
          );
        }
        if (cancelled) return;
        if (
          currentUserIdRef.current &&
          currentUserIdRef.current() !== expectedUserId
        ) {
          cancelled = true;
          return;
        }
        if (!isPendingEdgeMaterialization) {
          onResult(result);
        }
      } catch (error) {
        shouldContinue = true;
        consecutiveFailures += 1;
        nextDelayMs = getFailedPollDelayMs(consecutiveFailures, error);
      } finally {
        inFlight = false;
        if (cancelled || !shouldContinue) {
          resumeAfterFlight = false;
        } else if (resumeAfterFlight && appIsActive) {
          resumeAfterFlight = false;
          void poll();
        } else {
          schedule(nextDelayMs);
        }
      }
    };
    pollNowRef.current = () => {
      // A wake-up already waiting keeps its delay: repeated wake-ups
      // (reconnects, duplicate broadcasts) must not keep pushing the poll back.
      if (cancelled || !appIsActive || wakeupId) return;
      wakeupId = setTimeout(() => {
        wakeupId = undefined;
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = undefined;
        if (cancelled || !appIsActive) return;
        if (inFlight) {
          resumeAfterFlight = true;
          return;
        }
        void poll();
      }, randomDelay(QUIZ_RESULT_WAKEUP_MAX_DELAY_MS));
    };

    void poll();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
      if (nextState !== 'active') clearWakeup();
      appIsActive = nextState === 'active';
      if (!appIsActive) return;
      if (inFlight) {
        resumeAfterFlight = true;
        return;
      }
      resumeAfterFlight = false;
      void poll();
    });

    return () => {
      cancelled = true;
      pollNowRef.current = () => undefined;
      clearWakeup();
      if (timeoutId) clearTimeout(timeoutId);
      subscription.remove();
    };
  }, [attemptId, backendMode, enabled, expectedUserId, onResult]);
}
