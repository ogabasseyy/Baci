import {
  GIGL_ARRIVED_IN_CITY_RAW_STATUS,
  GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
} from '@/lib/shipping/gigl-tracking-notification-policy-matrix';
import type { TrackingEvent } from '../types';

const PLACE_NOISE_WORDS = new Set(['FCT', 'STATE', 'CITY', 'THE', 'OF']);
// Intentionally narrow: other in_transit scans at a destination-named centre
// count as arriving. Missing an arrival beats a false one, so extend with care.
const DEPARTURE_CODES = new Set(['DSC', 'DPC', 'DCC', 'DST', 'DTR', 'DIWN']);

function placeWords(value: string | undefined): string[] {
  return (value ?? '')
    .split('(')[0]
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 0 && !PLACE_NOISE_WORDS.has(word));
}

/**
 * Whole-word match: every destination word must appear as a word of the centre
 * name. Known limitation: text after "(" is ignored and abbreviations (PHC for
 * PORT HARCOURT) are not aliased, so such centres miss the name-match arrival
 * (an explicit ARF still counts). Missing a notification beats a false one.
 */
function matchesDestination(
  location: string | undefined,
  destination: string | undefined
): boolean {
  const cityWords = placeWords(destination);
  const centreWords = new Set(placeWords(location));
  return (
    cityWords.length > 0 && cityWords.every((word) => centreWords.has(word))
  );
}

export type Guardable = {
  event: TrackingEvent;
  recognizedStatus: TrackingEvent['status'] | null;
  /** The provider's own status code, before notification-specific rewrites. */
  providerStatus: string;
};

function isMshc(candidate: Guardable): number {
  return candidate.providerStatus.trim().toUpperCase() === 'MSHC' ? 1 : 0;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'delivered',
  'returned',
  'cancelled',
]);

/** Equal-timestamp precedence for the current status: terminal (delivered/returned/cancelled) > MSHC (still out for delivery) > rest. */
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

/**
 * GIG fires the generic "SHIPMENT ENROUTE DELIVERY" (MSHC) during the pickup
 * run, and an arrival scan also marks the parcel reaching its destination.
 * Walk the events oldest-first: MSHC is only out-for-delivery once the parcel
 * reached the destination or has already moved through GIG centres (centre
 * names rarely equal the destination city, e.g. IKEJA for LAGOS, so absence
 * of a name match is not evidence of first-mile); before any movement it is
 * the pickup rider en route.
 */
export function applyLifecycleGuards(
  candidates: Guardable[],
  destination: string | undefined,
  origin: string | undefined
): void {
  // A same-city shipment's origin centre also matches the destination, so a
  // name match only counts once the parcel has moved through the network. An
  // unknown origin (the field is optional) is treated the same way: the first
  // scan could be the origin centre, so require a scan away from the destination.
  const sameCity =
    placeWords(origin).length === 0 || matchesDestination(origin, destination);
  // Equal timestamps: process MSHC last so a contemporaneous arrival or
  // movement scan is seen first, whatever order the payload listed them in.
  const ordered = [...candidates].sort(
    (a, b) =>
      a.event.timestamp.getTime() - b.event.timestamp.getTime() ||
      isMshc(a) - isMshc(b)
  );
  let arrived = false;
  let movedThroughNetwork = false;
  let pickedUp = false;
  // Same-city shipments: only a scan away from the destination name proves
  // the parcel left the origin centre (repeat origin scans prove nothing).
  let leftDestinationCentre = false;
  for (const candidate of ordered) {
    const { event } = candidate;
    const raw = candidate.providerStatus.trim().toUpperCase();
    const isArrival =
      raw === 'ARF' ||
      (candidate.recognizedStatus === 'in_transit' &&
        !DEPARTURE_CODES.has(raw) &&
        !/DEPART/i.test(event.description) &&
        (!sameCity || leftDestinationCentre) &&
        matchesDestination(event.location, destination));
    if (isArrival) {
      arrived = true;
      event.rawStatus = GIGL_ARRIVED_IN_CITY_RAW_STATUS;
    } else if (raw === 'MSHC' && !arrived && !movedThroughNetwork) {
      if (pickedUp) {
        // Pickup already completed: do not regress the status to pickup, and
        // keep the raw code so no "rider en route" update is sent after it.
        event.status = 'picked_up';
        candidate.recognizedStatus = 'picked_up';
      } else {
        event.status = 'pickup_scheduled';
        event.rawStatus = GIGL_PICKUP_EN_ROUTE_RAW_STATUS;
        candidate.recognizedStatus = 'pickup_scheduled';
      }
    }
    if (candidate.recognizedStatus === 'picked_up') pickedUp = true;
    if (
      candidate.recognizedStatus === 'in_transit' ||
      candidate.recognizedStatus === 'out_for_delivery' ||
      candidate.recognizedStatus === 'failed' ||
      // A completed shipment already moved: a stale MSHC must not be rewritten.
      (candidate.recognizedStatus !== null &&
        TERMINAL_STATUSES.has(candidate.recognizedStatus))
    ) {
      movedThroughNetwork = true;
      // A scan without a location proves nothing about leaving the centre.
      if (
        placeWords(event.location).length > 0 &&
        !matchesDestination(event.location, destination)
      ) {
        leftDestinationCentre = true;
      }
    }
  }
}
