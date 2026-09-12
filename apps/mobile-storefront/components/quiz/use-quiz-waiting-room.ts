import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { QuizEvent } from '@/services/quiz-types';
import { calculateQuizServerClockOffset } from './use-quiz-server-clock';

const CLOCK_TICK_MS = 250;
const BOUNDARY_REFRESH_MIN_INTERVAL_MS = 1_000;

function getRemainingMs(event: QuizEvent, offsetMs: number): number {
  if (!event.startsAt) return 0;
  const startsAtMs = Date.parse(event.startsAt);
  if (!Number.isFinite(startsAtMs)) return 0;
  return Math.max(0, startsAtMs - (Date.now() + offsetMs));
}

function getRemainingSeconds(event: QuizEvent, offsetMs: number): number {
  return Math.ceil(getRemainingMs(event, offsetMs) / 1_000);
}

function isTerminal(status: QuizEvent['status']): boolean {
  return ['closed', 'completed', 'cancelled', 'finalizing'].includes(status);
}

type RefreshEvents = () => Promise<QuizEvent[]>;

export interface QuizWaitingRoomState {
  error: string | null;
  event: QuizEvent;
  isRefreshing: boolean;
  remainingSeconds: number;
}

export function useQuizWaitingRoom({
  event: initialEvent,
  onEventsUpdated,
  onExit,
  onStart,
  refresh,
}: {
  event: QuizEvent;
  onEventsUpdated?: (events: QuizEvent[]) => void;
  onExit: () => void;
  onStart: (eventId: string, termsAccepted: true) => void;
  refresh: RefreshEvents;
}): QuizWaitingRoomState {
  const [event, setEvent] = useState(initialEvent);
  const [offsetMs, setOffsetMs] = useState(() =>
    initialEvent.serverNow
      ? calculateQuizServerClockOffset(initialEvent.serverNow)
      : 0
  );
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getRemainingSeconds(initialEvent, offsetMs)
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventRef = useRef(initialEvent);
  const offsetRef = useRef(offsetMs);
  const refreshRef = useRef(refresh);
  const onEventsUpdatedRef = useRef(onEventsUpdated);
  const onExitRef = useRef(onExit);
  const onStartRef = useRef(onStart);
  const refreshRequestIdRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const inFlightRequestRef = useRef<number | null>(null);
  const refreshAuthoritativeRef = useRef<() => Promise<void>>(
    async () => undefined
  );
  const startedRef = useRef(false);
  const stoppedRef = useRef(false);
  const lastBoundaryRefreshAtRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  refreshRef.current = refresh;
  onEventsUpdatedRef.current = onEventsUpdated;
  onExitRef.current = onExit;
  onStartRef.current = onStart;

  const applyRefreshedEvent = (nextEvent: QuizEvent) => {
    eventRef.current = nextEvent;
    setEvent(nextEvent);
    if (nextEvent.serverNow) {
      const nextOffset = calculateQuizServerClockOffset(nextEvent.serverNow);
      offsetRef.current = nextOffset;
      setOffsetMs(nextOffset);
    }
    if (isTerminal(nextEvent.status)) {
      stoppedRef.current = true;
      onExitRef.current();
      return;
    }
    if (
      !startedRef.current &&
      appStateRef.current === 'active' &&
      (nextEvent.status === 'active' || nextEvent.status === 'open')
    ) {
      startedRef.current = true;
      onStartRef.current(nextEvent.id, true);
    }
  };

  refreshAuthoritativeRef.current = async () => {
    if (inFlightRequestRef.current !== null || stoppedRef.current) return;
    const requestId = ++refreshRequestIdRef.current;
    const requestGeneration = refreshGenerationRef.current;
    inFlightRequestRef.current = requestId;
    setIsRefreshing(true);
    try {
      const events = await refreshRef.current();
      if (
        stoppedRef.current ||
        requestGeneration !== refreshGenerationRef.current ||
        inFlightRequestRef.current !== requestId
      )
        return;
      onEventsUpdatedRef.current?.(events);
      const nextEvent = events.find(
        (candidate) => candidate.id === eventRef.current.id
      );
      if (nextEvent) {
        setError(null);
        applyRefreshedEvent(nextEvent);
      } else {
        setError('This quiz is no longer available.');
        stoppedRef.current = true;
        onExitRef.current();
      }
    } catch {
      if (
        requestGeneration === refreshGenerationRef.current &&
        inFlightRequestRef.current === requestId
      )
        setError('Waiting for the latest quiz status.');
    } finally {
      if (inFlightRequestRef.current === requestId) {
        inFlightRequestRef.current = null;
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (
        !mounted ||
        stoppedRef.current ||
        appStateRef.current === 'background' ||
        appStateRef.current === 'inactive'
      )
        return;
      const nextRemainingSeconds = getRemainingSeconds(
        eventRef.current,
        offsetRef.current
      );
      setRemainingSeconds(nextRemainingSeconds);
      if (nextRemainingSeconds === 0) {
        const now = Date.now();
        if (
          now - lastBoundaryRefreshAtRef.current >=
          BOUNDARY_REFRESH_MIN_INTERVAL_MS
        ) {
          lastBoundaryRefreshAtRef.current = now;
          void refreshAuthoritativeRef.current();
        }
      }
    };
    tick();
    const interval = setInterval(tick, CLOCK_TICK_MS);
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;
      if (nextState === 'background' || nextState === 'inactive') {
        refreshGenerationRef.current += 1;
        inFlightRequestRef.current = null;
        setIsRefreshing(false);
      }
      if (!wasActive && nextState === 'active')
        void refreshAuthoritativeRef.current();
    });
    return () => {
      mounted = false;
      stoppedRef.current = true;
      clearInterval(interval);
      subscription?.remove?.();
    };
  }, []);

  return { error, event, isRefreshing, remainingSeconds };
}
