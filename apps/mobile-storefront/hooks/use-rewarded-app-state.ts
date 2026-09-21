import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { setQuizRewardedFlowActive } from '@/lib/quiz-fullscreen-ownership';

interface AbandonableRewardedSession {
  cleanups: Array<() => void>;
  presented: boolean;
  settled: boolean;
}

/**
 * App-state tracking for the rewarded flow with background abandonment. A
 * pending rewarded load must not present on resume over whatever the
 * shopper sees, so background/inactive transitions abandon non-presented
 * sessions silently (no failure UI); presented ads stay owned by their
 * CLOSED handler. Returns the ref so presentation guards read it without
 * rerendering.
 */
export function useRewardedAppState(
  sessionRef: RefObject<AbandonableRewardedSession | null>,
  releaseOwnership: () => void
): RefObject<AppStateStatus> {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const releaseRef = useRef(releaseOwnership);
  releaseRef.current = releaseOwnership;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (nextState !== 'background' && nextState !== 'inactive') return;
      const session = sessionRef.current;
      if (!session || session.presented) return;
      session.settled = true;
      session.cleanups.forEach((unsubscribe) => {
        unsubscribe();
      });
      session.cleanups = [];
      sessionRef.current = null;
      setQuizRewardedFlowActive(false);
      releaseRef.current();
    });
    return () => subscription.remove();
  }, [sessionRef]);
  return appStateRef;
}
