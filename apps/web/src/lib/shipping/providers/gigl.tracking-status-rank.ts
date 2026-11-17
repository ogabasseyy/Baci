import type { TrackingEvent } from '../types';

export type Guardable = {
  event: TrackingEvent;
  recognizedStatus: TrackingEvent['status'] | null;
  /** The provider's own status code, before notification-specific rewrites. */
  providerStatus: string;
};

export function isMshc(candidate: Guardable): number {
  return candidate.providerStatus.trim().toUpperCase() === 'MSHC' ? 1 : 0;
}

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'delivered',
  'returned',
  'cancelled',
]);

/**
 * Equal-timestamp precedence for the current status: terminal
 * (delivered/returned/cancelled) > MSHC (still out for delivery) > rest.
 * `failed` is deliberately not terminal: an MSHC at the same time as a failed
 * attempt is the retry, so the shipment stays out for delivery.
 */
export function currentStatusRank(candidate: Guardable): number {
  if (
    candidate.recognizedStatus !== null &&
    TERMINAL_STATUSES.has(candidate.recognizedStatus)
  ) {
    return 3;
  }
  // A demoted (pickup-run) MSHC must not outrank a completed pickup.
  if (candidate.recognizedStatus === 'pickup_scheduled') return 0;
  return isMshc(candidate) ? 2 : 1;
}
