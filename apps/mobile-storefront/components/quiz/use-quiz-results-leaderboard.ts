import { useEffect, useRef, useState } from 'react';
import {
  fetchQuizLeaderboard,
  fetchQuizLiveLeaderboard,
  fetchQuizParticipantCount,
} from '@/services/quiz-leaderboard';
import type { QuizLeaderboard } from '@/services/quiz-types';
import type { QuizV2LifecycleStatus } from '@/stores/quiz-recovery-envelope';

const FINAL_RETRY_INTERVAL_MS = 5_000;
const LIVE_REFRESH_INTERVAL_MS = 1_000;

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
    let retryId: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const liveStandings = lifecycle === 'pending_results' && !eventHasEnded;
        const result = liveStandings
          ? await fetchQuizLiveLeaderboard({ eventId, expectedUserId })
          : await fetchQuizLeaderboard({ eventId, expectedUserId });
        if (!active) return;
        const liveParticipantCount = liveStandings
          ? await fetchQuizParticipantCount({ eventId, expectedUserId }).catch(
              () => null
            )
          : null;
        if (!active) return;
        setParticipantCount(liveParticipantCount ?? result.participantCount);
        if (result.status === 'published' || result.status === 'live') {
          setLeaderboard(result);
          hasLeaderboard.current = true;
          setLeaderboardError(false);
          if (result.status === 'live') {
            retryId = setTimeout(load, LIVE_REFRESH_INTERVAL_MS);
          }
          return;
        }
      } catch {
        if (!active) return;
        if (!hasLeaderboard.current) setLeaderboardError(true);
      }
      if (!active) return;
      retryId = setTimeout(
        load,
        lifecycle === 'pending_results'
          ? LIVE_REFRESH_INTERVAL_MS
          : FINAL_RETRY_INTERVAL_MS
      );
    };

    void load();
    return () => {
      active = false;
      if (retryId) clearTimeout(retryId);
    };
  }, [enabled, eventHasEnded, eventId, expectedUserId, lifecycle]);

  return { leaderboard, leaderboardError, participantCount };
}
