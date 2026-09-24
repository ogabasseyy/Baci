import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizV2Result } from '@/services/quiz-types';
import { useQuizServerClock } from './use-quiz-server-clock';

export const QUIZ_RESULT_POLL_INTERVAL_MS = 1_000;

export function useQuizResultPolling({
  attemptId,
  enabled,
  eventEndsAt = null,
  expectedUserId,
  onResult,
  serverNow = null,
}: {
  attemptId: string | null;
  enabled: boolean;
  eventEndsAt?: string | null;
  expectedUserId: string | null;
  onResult: (result: QuizV2Result) => void;
  serverNow?: string | null;
}) {
  const { offsetMs } = useQuizServerClock(serverNow);

  useEffect(() => {
    if (!enabled || !attemptId || !expectedUserId) return;

    const getOpensInMs = () => {
      if (!eventEndsAt) return 0;
      const endsAtMs = Date.parse(eventEndsAt);
      if (!Number.isFinite(endsAtMs)) return 0;
      return Math.max(0, endsAtMs - (Date.now() + offsetMs));
    };

    let cancelled = false;
    let inFlight = false;
    let resumeAfterFlight = false;
    let appIsActive =
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive';
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled || !appIsActive) return;
      timeoutId = setTimeout(poll, QUIZ_RESULT_POLL_INTERVAL_MS);
    };
    const poll = async () => {
      if (cancelled || !appIsActive || inFlight) return;
      const opensInMs = getOpensInMs();
      if (opensInMs > 0) {
        timeoutId = setTimeout(poll, opensInMs);
        return;
      }
      inFlight = true;
      let shouldContinue = false;
      try {
        const result = await fetchQuizResult({ attemptId, expectedUserId });
        shouldContinue = result.availability === 'pending';
        if (cancelled) return;
        onResult(result);
      } catch {
        shouldContinue = true;
      } finally {
        inFlight = false;
        if (cancelled || !shouldContinue) {
          resumeAfterFlight = false;
        } else if (resumeAfterFlight && appIsActive) {
          resumeAfterFlight = false;
          void poll();
        } else {
          schedule();
        }
      }
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
      if (timeoutId) clearTimeout(timeoutId);
      subscription.remove();
    };
  }, [attemptId, enabled, eventEndsAt, expectedUserId, offsetMs, onResult]);
}
