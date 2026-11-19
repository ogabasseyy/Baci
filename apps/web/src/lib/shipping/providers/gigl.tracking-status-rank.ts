import type { TrackingEvent } from '../types';
import { isMshc } from './gigl.tracking-mshc';
import { TERMINAL_STATUSES } from './gigl.tracking-terminal-statuses';

export type Guardable = {
  event: TrackingEvent;
  recognizedStatus: TrackingEvent['status'] | null;
  /** The provider's own status code, before notification-specific rewrites. */
  providerStatus: string;
  /** Reason and incident text together; either may carry a departure marker. */
  scanText?: string;
};

/**
 * Equal-timestamp precedence for the current status, highest first:
 * terminal (delivered/returned/cancelled) > MSHC (still out for delivery) >
 * any other progress (picked up, in transit...) > a demoted pickup-run MSHC >
 * pickup assignment (MAPT) > shipment creation (booked) > pending. The demoted MSHC
 * sits below completed pickup but above creation, so a same-time MCRT never
 * hides the pickup run. `failed` is deliberately not terminal: an MSHC at the
 * same time as a failed attempt is the retry, so the shipment stays out for
 * delivery.
 */
export function currentStatusRank(candidate: Guardable): number {
  const status = candidate.recognizedStatus;
  if (status !== null && TERMINAL_STATUSES.has(status)) {
    // Database order: delivered < returned/cancelled.
    return status === 'delivered' ? 6 : 7;
  }
  // SDR is "shipment destroyed", not a failed attempt: a same-time MSHC is not
  // a retry, so the destroyed state must stay visible (above MSHC, below the
  // terminal outcomes, like the database's order).
  if (candidate.providerStatus.trim().toUpperCase() === 'SDR') {
    return 5.5;
  }
  if (status === 'pickup_scheduled') {
    return isMshc(candidate) ? 3 : 2;
  }
  // An unrecognized scan (null) is emitted as pending, so it ranks as pending.
  if (status === 'pending' || status === null) {
    return 0;
  }
  if (status === 'booked') {
    return 1;
  }
  if (isMshc(candidate)) return 5;
  // Same order as the database's canonical status ranking.
  if (status === 'out_for_delivery' || status === 'failed') return 4.5;
  if (status === 'picked_up') return 3.5;
  return 4;
}
