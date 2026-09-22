import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';

// Completion authority per generation: a release retires the marker with
// a tombstone, and a later mark supersedes it. Removals consult this
// record immediately before deleting so a timed-out removal cannot
// delete a marker restored after the release.
type MarkerRecord =
  | { sequence: number; marked: true }
  | { sequence: number; tombstone: true };

let markerSequence = 0;
const markerRecords = new Map<string, MarkerRecord>();

function nextMarkerSequence(): number {
  markerSequence += 1;
  return markerSequence;
}

function latestMarkerRecord(
  checkoutGeneration: string
): MarkerRecord | undefined {
  return markerRecords.get(checkoutGeneration);
}

function noteMarkedCodepointSort(
  checkoutGeneration: string,
  sequence: number
): void {
  const latest = markerRecords.get(checkoutGeneration);
  if (!latest || sequence > latest.sequence) {
    markerRecords.set(checkoutGeneration, { sequence, marked: true });
  }
}

function noteMarkerTombstone(
  checkoutGeneration: string,
  sequence: number
): void {
  markerRecords.set(checkoutGeneration, { sequence, tombstone: true });
}

function markerKey(checkoutGeneration: string): string {
  return `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${checkoutGeneration}`;
}

export const codepointSortMarkerRecords = {
  key: markerKey,
  latest: latestMarkerRecord,
  nextSequence: nextMarkerSequence,
  noteMarked: noteMarkedCodepointSort,
  noteTombstone: noteMarkerTombstone,
};
