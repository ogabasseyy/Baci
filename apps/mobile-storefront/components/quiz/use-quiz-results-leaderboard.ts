import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizLiveLeaderboard } from '@/services/quiz-live-leaderboard';
import { type QuizLeaderboard, QuizServiceError } from '@/services/quiz-types';
import type { QuizV2LifecycleStatus } from '@/stores/quiz-recovery-envelope';
import { backoffDelay } from './quiz-retry-timing';

const LIVE_REFRESH_INTERVAL_MS = 10_000;
const FINAL_RETRY_INTERVAL_MS = 10_000;
const FAILURE_BACKOFF_CAP_MS = 60_000;
const OVERLOAD_RETRY_FLOOR_MS = 15_000;
const AUTH_BACKOFF_BASE_MS = 5_000;
const AUTH_BACKOFF_CAP_MS = 30_000;

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
  const [liveBoardHidden, setLiveBoardHidden] = useState(false);
  const currentUserIdRef = useRef(getCurrentUserId);
  useLayoutEffect(() => {
    currentUserIdRef.current = getCurrentUserId;
  }, [getCurrentUserId]);
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
    setLiveBoardHidden(false);
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
    let loadFailures = 0;
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
      const baseIntervalMs = isLive
        ? LIVE_REFRESH_INTERVAL_MS
        : FINAL_RETRY_INTERVAL_MS;
      // Spread every schedule so phones drift apart instead of polling in sync.
      let retryDelayMs: number | null = backoffDelay({
        baseMs: baseIntervalMs,
        failures: loadFailures,
        capMs: FAILURE_BACKOFF_CAP_MS,
      });
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
        loadFailures = 0;
        retryDelayMs = backoffDelay({
          baseMs: baseIntervalMs,
          failures: 0,
          capMs: FAILURE_BACKOFF_CAP_MS,
        });
        if (result.participantCount !== null) {
          setParticipantCount(result.participantCount);
        }
        if (
          isLive &&
          (result.status === 'unavailable' || result.status === 'live_hidden')
        ) {
          setLeaderboard(null);
          setParticipantCount(null);
          setLiveBoardHidden(true);
          hasLeaderboard.current = false;
          boardStatus.current = null;
        }
        if (result.status === 'published' || result.status === 'live') {
          setLiveBoardHidden(false);
          setLeaderboard(result);
          boardStatus.current = result.status;
          hasLeaderboard.current = true;
          setLeaderboardError(false);
          if (result.status !== 'live') retryDelayMs = null;
          return;
        }
      } catch (error) {
        if (!active) return;
        loadFailures += 1;
        retryDelayMs = backoffDelay({
          baseMs: baseIntervalMs,
          failures: loadFailures,
          capMs: FAILURE_BACKOFF_CAP_MS,
          floorMs:
            error instanceof QuizServiceError &&
            (error.status === 429 || error.status === 503)
              ? OVERLOAD_RETRY_FLOOR_MS
              : 0,
        });
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
            // Spread like every other retry here: phones whose sessions
            // were rejected together must not all retry in the same instant.
            retryDelayMs = backoffDelay({
              baseMs: AUTH_BACKOFF_BASE_MS,
              failures: authFailures,
              capMs: AUTH_BACKOFF_CAP_MS,
            });
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
  const visible = enabled && previousEventKey.current === currentKey;
  const showBoard =
    visible && !(lifecycle === 'final' && leaderboard?.status === 'live');
  return {
    leaderboard: showBoard ? leaderboard : null,
    leaderboardError: visible && leaderboardError,
    liveBoardHidden: visible && liveBoardHidden,
    participantCount: showBoard ? participantCount : null,
  };
}
