import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { calculateQuizServerClockOffset } from './use-quiz-server-clock';

const CLOCK_TICK_MS = 250;
const BOUNDARY_REFRESH_MIN_INTERVAL_MS = 1_000;
// Minimum countdown remaining (at lobby open) for the pre-quiz interstitial.
// Below this the ad could eat into live play, so it is skipped.
const QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS = 30;

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
  /**
   * While true a presented pre-quiz interstitial owns the full screen, so
   * banner slots must stay unmounted until it closes.
   */
  isFullscreenAdActive: boolean;
  isRefreshing: boolean;
  remainingSeconds: number;
}

export function useQuizWaitingRoom({
  event: initialEvent,
  onEventsUpdated,
  onExit,
  onStart,
  refresh,
  suspended = false,
}: {
  event: QuizEvent;
  onEventsUpdated?: (events: QuizEvent[]) => void;
  onExit: () => void;
  onStart: (eventId: string, termsAccepted: true) => void;
  refresh: RefreshEvents;
  /**
   * While true (e.g. the rules modal covers the lobby) a pending
   * interstitial load is abandoned instead of presenting a full-screen ad
   * over the modal.
   */
  suspended?: boolean;
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
  const [isFullscreenAdActive, setIsFullscreenAdActive] = useState(false);
  const isFullscreenAdActiveRef = useRef(false);
  // A start boundary that lands while the interstitial owns the screen waits
  // here until the ad closes instead of starting timed play behind it.
  const pendingStartRef = useRef<QuizEvent | null>(null);
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
  const suspendedRef = useRef(suspended);
  const lastBoundaryRefreshAtRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  refreshRef.current = refresh;
  onEventsUpdatedRef.current = onEventsUpdated;
  onExitRef.current = onExit;
  onStartRef.current = onStart;
  suspendedRef.current = suspended;

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
      // Starting live play behind a presented interstitial would burn the
      // shopper's timed window under a full-screen ad: hold the transition
      // until the ad closes (flushed in its onClosed handler below).
      if (isFullscreenAdActiveRef.current) {
        pendingStartRef.current = nextEvent;
        return;
      }
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
    // Fire-and-forget: the lobby countdown keeps ticking underneath and play
    // never waits on the ad. The load is abandoned if the shopper moves into
    // live play, the lobby unmounts, the rules modal suspends the lobby, or
    // the countdown reaches the safety margin while the load is in flight. The request requires strictly more
    // than 30 seconds, so presentation cancels at 30 or below: a whole
    // "30" on screen can be as little as 29.001 real seconds.
    if (
      getRemainingSeconds(eventRef.current, offsetRef.current) >
      QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS
    ) {
      void maybeShowQuizStartInterstitial({
        isCancelled: () =>
          !mounted ||
          startedRef.current ||
          stoppedRef.current ||
          suspendedRef.current ||
          // A backgrounded app must never present on LOADED: the ad would
          // surface only when the shopper resumes, over whatever they see.
          // Mirrors the countdown tick guard below: only background/inactive
          // cancel, so transient states never abandon the load.
          appStateRef.current === 'background' ||
          appStateRef.current === 'inactive' ||
          getRemainingSeconds(eventRef.current, offsetRef.current) <=
            QUIZ_START_INTERSTITIAL_MIN_REMAINING_SECONDS,
        onClosed: () => {
          if (!mounted) return;
          isFullscreenAdActiveRef.current = false;
          setIsFullscreenAdActive(false);
          // A native dismissal while the app is inactive must not start
          // timed play in the background: retain the pending transition
          // until the foreground refresh re-validates it on resume.
          if (appStateRef.current !== 'active') return;
          const pendingStart = pendingStartRef.current;
          pendingStartRef.current = null;
          if (pendingStart && !startedRef.current && !stoppedRef.current) {
            startedRef.current = true;
            onStartRef.current(pendingStart.id, true);
          }
        },
      }).then((outcome) => {
        if (mounted && outcome === 'shown') {
          isFullscreenAdActiveRef.current = true;
          setIsFullscreenAdActive(true);
        }
      });
    }
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

  return {
    error,
    event,
    isFullscreenAdActive,
    isRefreshing,
    remainingSeconds,
  };
}
