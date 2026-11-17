import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { SavingsStatusCheckResult } from './use-pending-savings-status-check';

/** Waits before each automatic status read: 5 s, 10 s, 20 s, then every 30 s. */
export const STATUS_POLL_BACKOFF_MS = [5_000, 10_000, 20_000] as const;
export const STATUS_POLL_INTERVAL_MS = 30_000;
/** Automatic reads stop after this long; returning to the app starts again. */
export const STATUS_POLL_WINDOW_MS = 5 * 60_000;

/** Outcomes that leave the contribution unsettled, so the polling goes on. */
// 'blocked' (the rail is briefly unavailable while the operation is kept)
// keeps going too: nothing else would resume the checks if it comes back.
const KEEP_POLLING: ReadonlySet<SavingsStatusCheckResult> = new Set([
  'pending',
  'unavailable',
  'busy',
  'blocked',
]);

export function statusPollDelay(attempt: number): number {
  return STATUS_POLL_BACKOFF_MS[attempt] ?? STATUS_POLL_INTERVAL_MS;
}

/**
 * Keeps asking about a pending contribution for as long as the operation is
 * stored, independent of which sheet or card is on screen (incident
 * 2026-11-17: the card's own timer died, and a transfer confirmed two
 * minutes later was never picked up). Status reads only: `check` never
 * starts a transfer. Stops when the operation settles or is dropped, on
 * unmount, or after STATUS_POLL_WINDOW_MS. Nothing is read while the app is
 * in the background: leaving pauses the run, and a return to the foreground
 * with the operation still stored checks at once (a read still in flight
 * answers busy and the next tick reads again) and starts a fresh window.
 */
export function usePendingSavingsStatusPolling(
  operationId: string | null,
  check: () => Promise<SavingsStatusCheckResult>
) {
  // The newest check (it closes over the current goal and refs).
  const latestCheck = useRef(check);
  useEffect(() => {
    latestCheck.current = check;
  });
  useEffect(() => {
    if (!operationId) return;
    let active = true;
    // Each (re)start is a new run; a stale run's late answer schedules nothing.
    let run = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Reads now, then (if still unsettled) schedules backoff step nextAttempt.
    const checkThen = (
      ownRun: number,
      nextAttempt: number,
      startedAt: number
    ) => {
      const next = (outcome: SavingsStatusCheckResult) => {
        if (!active || ownRun !== run || !KEEP_POLLING.has(outcome)) return;
        schedule(ownRun, nextAttempt, startedAt);
      };
      latestCheck.current().then(next, () => next('unavailable'));
    };
    const schedule = (ownRun: number, attempt: number, startedAt: number) => {
      const delay = statusPollDelay(attempt);
      if (Date.now() + delay - startedAt > STATUS_POLL_WINDOW_MS) return;
      timer = setTimeout(
        () => checkThen(ownRun, attempt + 1, startedAt),
        delay
      );
    };
    // Mounted in the background: wait for the app to come back.
    if (AppState.currentState !== 'background') schedule(run, 0, Date.now());
    const subscription = AppState.addEventListener('change', (state) => {
      // Any change ends the current run, so nothing is read in the background.
      clearTimeout(timer);
      run += 1;
      // Back in the app: read at once, then restart the backoff from its start.
      if (state === 'active') checkThen(run, 0, Date.now());
    });
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [operationId]);
}
