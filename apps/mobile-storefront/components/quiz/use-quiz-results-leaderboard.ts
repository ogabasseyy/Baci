import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizLiveLeaderboard } from '@/services/quiz-live-leaderboard';
import { type QuizLeaderboard, QuizServiceError } from '@/services/quiz-types';
import type { QuizV2LifecycleStatus } from '@/stores/quiz-recovery-envelope';

const LIVE_REFRESH_INTERVAL_MS = 5_000;
const FINAL_RETRY_INTERVAL_MS = 5_000;

interface UseQuizResultsLeaderboardInput {
  enabled: boolean;
  eventHasEnded: boolean;
  eventId: string | null;
  expectedUserId: string | null;
  lifecycle: QuizV2LifecycleStatus;
  getCurrentUserId?: () => string | null;
  deferFinalUntilPublished?: boolean;
}

export function useQuizResultsLeaderboard({
  enabled,
  eventHasEnded,
  eventId,
  expectedUserId,
  lifecycle,
  getCurrentUserId,
  deferFinalUntilPublished = false,
}: UseQuizResultsLeaderboardInput) {
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboard | null>(null);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const [participantCount, setParticipantCount] = useState<number | null>(null);
  const currentUserIdRef = useRef(getCurrentUserId);
  currentUserIdRef.current = getCurrentUserId;
  const hasLeaderboard = useRef(false);
  const boardStatus = useRef<QuizLeaderboard['status'] | null>(null);
  const previousEventKey = useRef<string | null>(null);
  const isLive =
    lifecycle === 'pending_results' &&
    (!eventHasEnded || deferFinalUntilPublished);

  useEffect(() => {
    const eventKey = `${eventId ?? ''}:${expectedUserId ?? ''}`;
    const eventChanged = previousEventKey.current !== eventKey;
    if (eventChanged) {
      previousEventKey.current = eventKey;
      setLeaderboard(null);
      setParticipantCount(null);
      hasLeaderboard.current = false;
      boardStatus.current = null;
    }
    if (lifecycle === 'final' && boardStatus.current === 'live') {
      setLeaderboard(null);
      setParticipantCount(null);
      hasLeaderboard.current = false;
      boardStatus.current = null;
    }
    setLeaderboardError(false);
    if (!enabled || !eventId || !expectedUserId) {
      setLeaderboard(null);
      setParticipantCount(null);
      hasLeaderboard.current = false;
      boardStatus.current = null;
      return;
    }

    let active = true;
    let appIsActive =
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive';
    let loadInFlight = false;
    let authFailures = 0;
    let retryId: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delayMs: number) => {
      if (!active || !appIsActive) return;
      if (retryId) clearTimeout(retryId);
      retryId = setTimeout(() => {
        retryId = undefined;
        void load();
      }, delayMs);
    };
    const load = async () => {
      if (!active || !appIsActive || loadInFlight) return;
      loadInFlight = true;
      // A transient finalization failure must not strand the result screen.
      // Keep a bounded retry loop until the immutable published board arrives;
      // once it succeeds the success path disables further polling.
      let retryDelayMs: number | null = isLive
        ? LIVE_REFRESH_INTERVAL_MS
        : FINAL_RETRY_INTERVAL_MS;
      try {
        const result = isLive
          ? await fetchQuizLiveLeaderboard({ eventId, expectedUserId })
          : await fetchQuizLeaderboard({ eventId, expectedUserId });
        if (
          !active ||
          (currentUserIdRef.current &&
            currentUserIdRef.current() !== expectedUserId)
        )
          return;
        authFailures = 0;
        if (result.participantCount !== null) {
          setParticipantCount(result.participantCount);
        }
        if (
          isLive &&
          (result.status === 'unavailable' || result.status === 'live_hidden')
        ) {
          setLeaderboard(null);
          setParticipantCount(null);
          hasLeaderboard.current = false;
          boardStatus.current = null;
        }
        if (result.status === 'published' || result.status === 'live') {
          setLeaderboard(result);
          boardStatus.current = result.status;
          hasLeaderboard.current = true;
          setLeaderboardError(false);
          if (result.status === 'live') {
            retryDelayMs = LIVE_REFRESH_INTERVAL_MS;
          } else {
            retryDelayMs = null;
          }
          return;
        }
      } catch (error) {
        if (!active) return;
        if (
          error instanceof QuizServiceError &&
          (error.status === 401 ||
            error.status === 403 ||
            error.code === 'quiz_session_changed')
        ) {
          setLeaderboard(null);
          setParticipantCount(null);
          hasLeaderboard.current = false;
          boardStatus.current = null;
          if (
            error.status === 401 &&
            error.code !== 'quiz_session_changed' &&
            (!currentUserIdRef.current ||
              currentUserIdRef.current() === expectedUserId)
          ) {
            authFailures += 1;
            retryDelayMs = Math.min(
              LIVE_REFRESH_INTERVAL_MS * 2 ** Math.min(authFailures - 1, 3),
              30_000
            );
          } else {
            retryDelayMs = null;
          }
        }
        if (!hasLeaderboard.current) setLeaderboardError(true);
      } finally {
        loadInFlight = false;
        if (retryDelayMs !== null) schedule(retryDelayMs);
      }
    };

    void load();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (retryId) clearTimeout(retryId);
      retryId = undefined;
      appIsActive = nextState === 'active';
      if (appIsActive) void load();
    });
    return () => {
      active = false;
      if (retryId) clearTimeout(retryId);
      subscription.remove();
    };
  }, [enabled, eventId, expectedUserId, isLive, lifecycle]);

  const currentKey = `${eventId ?? ''}:${expectedUserId ?? ''}`;
  const visible =
    enabled &&
    previousEventKey.current === currentKey &&
    (!currentUserIdRef.current ||
      currentUserIdRef.current() === expectedUserId);
  const showBoard =
    visible && !(lifecycle === 'final' && leaderboard?.status === 'live');
  return {
    leaderboard: showBoard ? leaderboard : null,
    leaderboardError: visible && leaderboardError,
    participantCount: showBoard ? participantCount : null,
  };
}
