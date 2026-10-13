import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

const TICK_INTERVAL_MS = 250;

function getEventRemainingMs(deadlineMs: number, offsetMs: number): number {
  return Number.isFinite(deadlineMs)
    ? Math.max(0, deadlineMs - (Date.now() + offsetMs))
    : 0;
}

export function useQuizEventTimer({
  eventEndsAt,
  isActive,
  onExpire,
  shouldTick = isActive,
  serverClockOffsetMs = 0,
}: {
  eventEndsAt: string | null;
  isActive: boolean;
  onExpire: () => void;
  shouldTick?: boolean;
  serverClockOffsetMs?: number;
}): { remainingSeconds: number; hasEnded: boolean } {
  const deadlineMs = eventEndsAt ? Date.parse(eventEndsAt) : Number.NaN;
  const [remainingMs, setRemainingMs] = useState(() =>
    getEventRemainingMs(deadlineMs, serverClockOffsetMs)
  );
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    firedRef.current = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const evaluate = () => {
      const remaining = getEventRemainingMs(deadlineMs, serverClockOffsetMs);
      setRemainingMs(remaining);
      if (isActive && remaining === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
      if (remaining === 0 && intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    evaluate();
    if (
      !shouldTick ||
      !Number.isFinite(deadlineMs) ||
      getEventRemainingMs(deadlineMs, serverClockOffsetMs) === 0
    )
      return;
    intervalId = setInterval(evaluate, TICK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') evaluate();
    });
    return () => {
      if (intervalId) clearInterval(intervalId);
      subscription?.remove?.();
    };
  }, [deadlineMs, isActive, serverClockOffsetMs, shouldTick]);

  return {
    hasEnded: remainingMs === 0,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}
