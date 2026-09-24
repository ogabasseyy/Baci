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
  serverClockOffsetMs = 0,
  ticking = isActive,
}: {
  eventEndsAt: string | null;
  isActive: boolean;
  onExpire: () => void;
  serverClockOffsetMs?: number;
  ticking?: boolean;
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
    const evaluate = () => {
      const remaining = getEventRemainingMs(deadlineMs, serverClockOffsetMs);
      setRemainingMs(remaining);
      if (isActive && remaining === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };
    evaluate();
    if (!ticking || !Number.isFinite(deadlineMs)) return;
    const intervalId = setInterval(evaluate, TICK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') evaluate();
    });
    return () => {
      clearInterval(intervalId);
      subscription?.remove?.();
    };
  }, [deadlineMs, isActive, serverClockOffsetMs, ticking]);

  return {
    hasEnded: remainingMs === 0,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}
