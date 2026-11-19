import {
  type NormalizedShipmentStatus,
  SHIPMENT_STATUS_LABELS,
} from '../tracking-types';
import type { Guardable } from './gigl.tracking-status-rank';
import { TERMINAL_STATUSES } from './gigl.tracking-terminal-statuses';

type Aggregate = {
  status: NormalizedShipmentStatus;
  /** Event that must lead the list: the worker reads the snapshot location from events[0]. */
  lead: Guardable | undefined;
};

// Canonical precedence among terminal outcomes (matches the database rank:
// cancelled and returned outrank delivered, whatever their order in time).
function terminalPrecedence(candidate: Guardable): number {
  // cancelled and returned share the database rank; a tied pair resolves to
  // cancelled (it also stops the monitor and refunds) so the result never
  // depends on the payload order.
  if (candidate.recognizedStatus === 'cancelled') return 3;
  return candidate.recognizedStatus === 'delivered' ? 1 : 2;
}

// Guardable carries the event's free-form status string; narrow it to the
// lifecycle statuses (anything else means no recognised lifecycle state).
function toStatus(value: string | null | undefined): NormalizedShipmentStatus {
  return value && value in SHIPMENT_STATUS_LABELS
    ? (value as NormalizedShipmentStatus)
    : 'pending';
}

function isSdr(candidate: Guardable): boolean {
  return candidate.providerStatus.trim().toUpperCase() === 'SDR';
}

/**
 * Aggregate status for a poll's scans (newest first). A terminal outcome beats
 * later progress scans and the SDR fence (unless the SDR is newer than it); SDR
 * keeps a destroyed shipment failed. The returned lead event owns the snapshot.
 */
export function resolveAggregate(
  candidates: Guardable[]
): Aggregate & { recognizedStatus: Aggregate['status'] } {
  // Newest first, whatever order the caller passed (stable for ties).
  const sortedCandidates = [...candidates].sort(
    (left, right) =>
      right.event.timestamp.getTime() - left.event.timestamp.getTime()
  );
  const newestRecognized = sortedCandidates.find(
    (candidate) => candidate.recognizedStatus !== null
  );
  const recognizedStatus = toStatus(newestRecognized?.recognizedStatus);
  const sdrScans = sortedCandidates.filter(isSdr);
  const newestSdrAt = sdrScans[0]?.event.timestamp.getTime();
  // Only terminal scans at or after the newest SDR can outlive it (a tied
  // terminal outranks the SDR, as in currentStatusRank);
  // precedence is applied after that fence.
  const bestTerminal = sortedCandidates
    .filter(
      (candidate) =>
        candidate.recognizedStatus !== null &&
        TERMINAL_STATUSES.has(candidate.recognizedStatus) &&
        (newestSdrAt === undefined ||
          candidate.event.timestamp.getTime() >= newestSdrAt)
    )
    .reduce<Guardable | undefined>(
      (best, candidate) =>
        best === undefined ||
        terminalPrecedence(candidate) > terminalPrecedence(best)
          ? candidate
          : best,
      undefined
    );
  const terminalWins = bestTerminal !== undefined;
  if (terminalWins) {
    return {
      status: toStatus(bestTerminal.recognizedStatus),
      // Already the newest recognized scan: leave the order (an unknown newer
      // scan keeps leading, as before).
      lead: bestTerminal === newestRecognized ? undefined : bestTerminal,
      recognizedStatus,
    };
  }
  if (sdrScans.length > 0 && !TERMINAL_STATUSES.has(recognizedStatus)) {
    return {
      status: 'failed',
      lead: sdrScans[0] === newestRecognized ? undefined : sdrScans[0],
      recognizedStatus,
    };
  }
  return { status: recognizedStatus, lead: undefined, recognizedStatus };
}
