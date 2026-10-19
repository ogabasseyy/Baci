import { useRef } from 'react';

export function calculateQuizServerClockOffset(
  serverNow: string,
  observedAtMs = Date.now()
): number {
  const parsed = Date.parse(serverNow);
  return Number.isFinite(parsed) ? parsed - observedAtMs : 0;
}

export function useQuizServerClock(
  serverNow: string | null,
  observedAtMs?: number
): { offsetMs: number; serverNowMs: number } {
  const initialObservedAt = observedAtMs ?? Date.now();
  const key = `${serverNow ?? 'none'}:${observedAtMs ?? 'received'}`;
  const snapshotRef = useRef({
    key,
    offsetMs: serverNow
      ? calculateQuizServerClockOffset(serverNow, initialObservedAt)
      : 0,
  });
  if (snapshotRef.current.key !== key) {
    const receivedAt = observedAtMs ?? Date.now();
    snapshotRef.current = {
      key,
      offsetMs: serverNow
        ? calculateQuizServerClockOffset(serverNow, receivedAt)
        : 0,
    };
  }
  return {
    offsetMs: snapshotRef.current.offsetMs,
    serverNowMs: Date.now() + snapshotRef.current.offsetMs,
  };
}
