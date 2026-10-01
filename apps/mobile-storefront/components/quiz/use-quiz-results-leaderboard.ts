import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizLiveLeaderboard } from '@/services/quiz-live-leaderboard';
import type { QuizLeaderboard } from '@/services/quiz-types';
import type { QuizV2LifecycleStatus } from '@/stores/quiz-recovery-envelope';

const LIVE_REFRESH_INTERVAL_MS = 5_000;
const FINAL_RETRY_INTERVAL_MS = 5_000;

interface UseQuizResultsLeaderboardInput {
  enabled: boolean;
  eventHasEnded: boolean;
  eventId: string | null;
  expectedUserId: string | null;
  lifecycle: QuizV2LifecycleStatus;
}

export function useQuizResultsLeaderboard({
  enabled,
  eventHasEnded,
  eventId,
  expectedUserId,
  lifecycle,
}: UseQuizResultsLeaderboardInput) {
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboard | null>(null);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const [participantCount, setParticipantCount] = useState<number | null>(null);
  const hasLeaderboard = useRef(false);
  const previousEventKey = useRef<string | null>(null);
  const isLive = lifecycle === 'pending_results' && !eventHasEnded;

  useEffect(() => {
    const eventKey = `${eventId ?? ''}:${expectedUserId ?? ''}`;
    const eventChanged = previousEventKey.current !== eventKey;
    if (eventChanged) {
      previousEventKey.current = eventKey;
      setLeaderboard(null);
      setParticipantCount(null);
      hasLeaderboard.current = false;
    }
    setLeaderboardError(false);
    if (!enabled || !eventId || !expectedUserId) return;

    let active = true;
    let appIsActive =
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive';
    let loadInFlight = false;
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
        if (!active) return;
        if (result.participantCount !== null) {
          setParticipantCount(result.participantCount);
        }
        if (result.status === 'published' || result.status === 'live') {
          setLeaderboard(result);
          hasLeaderboard.current = true;
          setLeaderboardError(false);
          if (result.status === 'live') {
            retryDelayMs = LIVE_REFRESH_INTERVAL_MS;
          } else {
            retryDelayMs = null;
          }
          return;
        }
      } catch {
        if (!active) return;
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
  }, [enabled, eventId, expectedUserId, isLive]);

  return { leaderboard, leaderboardError, participantCount };
}
