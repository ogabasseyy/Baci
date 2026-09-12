import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizV2Result } from '@/services/quiz-types';
import { useQuizResultRealtimeWakeup } from './use-quiz-result-realtime-wakeup';

export const QUIZ_RESULT_POLL_INTERVAL_MS = 5_000;
export const QUIZ_RESULT_POLL_MAX_INTERVAL_MS = 30_000;
export const QUIZ_RESULT_POST_DEADLINE_FALLBACK_MIN_MS = 8_000;
const QUIZ_RESULT_POST_DEADLINE_FALLBACK_JITTER_MS = 4_000;

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
    return Math.min(availableAtMs - nowMs, QUIZ_RESULT_POLL_MAX_INTERVAL_MS);
  }
  if (Number.isFinite(availableAtMs)) {
    return getStableFallbackDelayMs(attemptId);
  }
  return QUIZ_RESULT_POLL_MAX_INTERVAL_MS;
}

function getFailedPollDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  return Math.min(
    QUIZ_RESULT_POLL_INTERVAL_MS * 2 ** exponent,
    QUIZ_RESULT_POLL_MAX_INTERVAL_MS
  );
}

export function useQuizResultPolling({
  attemptId,
  enabled,
  eventId,
  expectedUserId,
  getCurrentUserId,
  onResult,
}: {
  attemptId: string | null;
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
    enabled: enabled && Boolean(attemptId && expectedUserId),
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

    const schedule = (delayMs = QUIZ_RESULT_POLL_INTERVAL_MS) => {
      if (cancelled || !appIsActive) return;
      timeoutId = setTimeout(poll, delayMs);
    };
    const poll = async () => {
      if (cancelled || !appIsActive || inFlight) return;
      inFlight = true;
      let shouldContinue = false;
      let nextDelayMs = QUIZ_RESULT_POLL_INTERVAL_MS;
      try {
        const result = await fetchQuizResult({ attemptId, expectedUserId });
        consecutiveFailures = 0;
        if (result.availability === 'pending') {
          shouldContinue = true;
          nextDelayMs = getPendingPollDelayMs(result.availableAt, attemptId);
        }
        if (cancelled) return;
        if (
          currentUserIdRef.current &&
          currentUserIdRef.current() !== expectedUserId
        ) {
          cancelled = true;
          return;
        }
        onResult(result);
      } catch {
        shouldContinue = true;
        consecutiveFailures += 1;
        nextDelayMs = getFailedPollDelayMs(consecutiveFailures);
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
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
      if (cancelled || !appIsActive) return;
      if (inFlight) {
        resumeAfterFlight = true;
        return;
      }
      void poll();
    };

    void poll();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
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
      if (timeoutId) clearTimeout(timeoutId);
      subscription.remove();
    };
  }, [attemptId, enabled, expectedUserId, onResult]);
}
