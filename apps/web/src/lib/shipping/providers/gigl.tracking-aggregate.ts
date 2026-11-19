import type { TrackingResult } from '../types';
import type { Guardable } from './gigl.tracking-status-rank';
import { TERMINAL_STATUSES } from './gigl.tracking-terminal-statuses';

type Aggregate = {
  status: TrackingResult['status'];
  /** Event that must lead the list: the worker reads the snapshot location from events[0]. */
  lead: Guardable | undefined;
};

// Canonical precedence among terminal outcomes (matches the database rank:
// cancelled and returned outrank delivered, whatever their order in time).
function terminalPrecedence(candidate: Guardable): number {
  return candidate.recognizedStatus === 'delivered' ? 1 : 2;
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
  sortedCandidates: Guardable[]
): Aggregate & { recognizedStatus: Aggregate['status'] } {
  const newestRecognized = sortedCandidates.find(
    (candidate) => candidate.recognizedStatus !== null
  );
  const recognizedStatus = newestRecognized?.recognizedStatus ?? 'pending';
  const sdrScans = sortedCandidates.filter(isSdr);
  const bestTerminal = sortedCandidates
    .filter(
      (candidate) =>
        candidate.recognizedStatus !== null &&
        TERMINAL_STATUSES.has(candidate.recognizedStatus)
    )
    .reduce<Guardable | undefined>(
      (best, candidate) =>
        best === undefined ||
        terminalPrecedence(candidate) > terminalPrecedence(best)
          ? candidate
          : best,
      undefined
    );
  const newestSdrAt = sdrScans[0]?.event.timestamp.getTime();
  const terminalWins =
    bestTerminal !== undefined &&
    !(
      newestSdrAt !== undefined &&
      newestSdrAt > bestTerminal.event.timestamp.getTime()
    );
  if (terminalWins) {
    return {
      status: bestTerminal.recognizedStatus ?? recognizedStatus,
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
