import {
  GIGL_ARRIVED_IN_CITY_RAW_STATUS,
  GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
} from '@/lib/shipping/gigl-tracking-notification-policy-matrix';
import {
  DEPARTURE_CODES,
  DEPARTURE_WORD,
  EXPLICIT_ARRIVAL_CODES,
  FOREIGN_OFFICE_DESTINATIONS,
  RETURN_CODES,
  RETURN_FLOW_CODES,
} from './gigl.tracking-arrival-codes';
import { isMshc } from './gigl.tracking-mshc';
import type { Guardable } from './gigl.tracking-status-rank';
import { TERMINAL_STATUSES } from './gigl.tracking-terminal-statuses';

const PLACE_NOISE_WORDS = new Set(['FCT', 'STATE', 'CITY', 'THE', 'OF']);
function isSdr(candidate: Guardable): number {
  return candidate.providerStatus.trim().toUpperCase() === 'SDR' ? 1 : 0;
}

// A return signal: one of the return codes, or any scan the status map reads
// as a completed return (e.g. VFSSRR).
function startsReturnFlow(candidate: Guardable): boolean {
  return (
    RETURN_FLOW_CODES.has(candidate.providerStatus.trim().toUpperCase()) ||
    candidate.recognizedStatus === 'returned'
  );
}

function isReturnFlow(candidate: Guardable): number {
  return startsReturnFlow(candidate) ? 1 : 0;
}

// A located scan that could take the arrival status (explicit code, or an
// in-transit scan at the destination centre).
function locatedArrivalCandidate(
  candidate: Guardable,
  destination: string | undefined
): number {
  const raw = candidate.providerStatus.trim().toUpperCase();
  const { location } = candidate.event;
  if (placeWords(location).length === 0) return 0;
  const explicit =
    EXPLICIT_ARRIVAL_CODES.has(raw) ||
    FOREIGN_OFFICE_DESTINATIONS[raw]?.test((destination ?? '').toUpperCase());
  const inferred =
    candidate.recognizedStatus === 'in_transit' &&
    !DEPARTURE_CODES.has(raw) &&
    !RETURN_CODES.has(raw) &&
    !DEPARTURE_WORD.test(
      `${raw} ${candidate.scanText || candidate.event.description}`
    ) &&
    matchesDestination(location, destination);
  return explicit || inferred ? 1 : 0;
}

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

function awayFromDestination(
  candidate: Guardable,
  destination: string | undefined
): number {
  const { location } = candidate.event;
  return placeWords(location).length > 0 &&
    !matchesDestination(location, destination)
    ? 1
    : 0;
}

function isTerminal({ recognizedStatus }: Guardable): number {
  return recognizedStatus === 'delivered' || recognizedStatus === 'cancelled'
    ? 1
    : 0;
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
  const originKnown = placeWords(origin).length > 0;
  const originIsDestination =
    originKnown && matchesDestination(origin, destination);
  const sameCity = !originKnown || originIsDestination;
  // Equal timestamps: process MSHC last so a contemporaneous arrival or
  // movement scan is seen first, whatever order the payload listed them in.
  const ordered = [...candidates].sort(
    (a, b) =>
      a.event.timestamp.getTime() - b.event.timestamp.getTime() ||
      // A same-time SDR is processed first so it fences the other tied scans.
      isSdr(b) - isSdr(a) ||
      // A same-time return scan is processed before any arrival so it fences it.
      isReturnFlow(b) - isReturnFlow(a) ||
      // Likewise a same-time delivered or cancelled scan.
      isTerminal(b) - isTerminal(a) ||
      isMshc(a) - isMshc(b) ||
      // Tied scans: movement away from the destination first, so the result
      // does not depend on payload order.
      awayFromDestination(b, destination) -
        awayFromDestination(a, destination) ||
      // Then the located arrival candidate takes the arrival status, so its
      // centre can become the snapshot location whatever the payload order.
      locatedArrivalCandidate(b, destination) -
        locatedArrivalCandidate(a, destination)
  );
  let arrived = false;
  let movedThroughNetwork = false;
  let pickedUp = false;
  // SDR ("Shipment Destroyed") is final: a later or same-time MSHC cannot revive it.
  let destroyed = false;
  // Latched by a return-flow scan; fences arrival promotion like SDR does.
  let returning = false;
  // A delivered or cancelled parcel gets no arrival update, unless a later
  // failed scan reopens it (same rule as the aggregate).
  let closedAt = Number.NEGATIVE_INFINITY;
  // Same-city shipments: only a scan away from the destination name proves
  // the parcel left the origin centre (repeat origin scans prove nothing).
  let leftDestinationCentre = false;
  for (const candidate of ordered) {
    const { event } = candidate;
    const raw = candidate.providerStatus.trim().toUpperCase();
    const isArrival =
      // One arrival per shipment: only the first explicit or inferred arrival
      // is rewritten to the synthetic status.
      !destroyed &&
      !returning &&
      closedAt === Number.NEGATIVE_INFINITY &&
      !arrived &&
      // A mapped reason that says failed/delivered/returned is not an arrival.
      (candidate.recognizedStatus === null ||
        candidate.recognizedStatus === 'in_transit') &&
      // Departure wording overrides even an explicit arrival code.
      !DEPARTURE_WORD.test(
        `${raw} ${candidate.scanText || event.description}`
      ) &&
      (EXPLICIT_ARRIVAL_CODES.has(raw) ||
        FOREIGN_OFFICE_DESTINATIONS[raw]?.test(
          (destination ?? '').toUpperCase()
        ) ||
        (candidate.recognizedStatus === 'in_transit' &&
          !DEPARTURE_CODES.has(raw) &&
          !RETURN_CODES.has(raw) &&
          // A known same-city shipment never infers by name: a district centre
          // that omits the city token is not proof the parcel left the city.
          !originIsDestination &&
          (!sameCity || leftDestinationCentre) &&
          matchesDestination(event.location, destination)));
    if (raw === 'SDR') destroyed = true;
    if (startsReturnFlow(candidate)) returning = true;
    // Only a strictly later failure reopens; a tied terminal wins, as in the
    // aggregate.
    const time = event.timestamp.getTime();
    if (candidate.recognizedStatus === 'failed' && time > closedAt) {
      closedAt = Number.NEGATIVE_INFINITY;
    }
    if (isTerminal(candidate)) closedAt = time;
    if (isArrival) {
      arrived = true;
      if (candidate.recognizedStatus === null) {
        event.status = 'in_transit';
        candidate.recognizedStatus = 'in_transit';
      }
      event.rawStatus = GIGL_ARRIVED_IN_CITY_RAW_STATUS;
    } else if (raw === 'MSHC' && !arrived && !movedThroughNetwork) {
      if (pickedUp) {
        // Pickup already completed: do not regress the status to pickup, and
        // keep the raw code so no "rider en route" update is sent after it.
        event.status = 'picked_up';
        // The normalizer may already have swapped in the pickup-en-route raw
        // status (reason text); restore the provider code so raw policies do not
        // enqueue a merchant pickup_en_route update after collection.
        event.rawStatus = candidate.providerStatus;
        candidate.recognizedStatus = 'picked_up';
      } else {
        event.status = 'pickup_scheduled';
        event.rawStatus = GIGL_PICKUP_EN_ROUTE_RAW_STATUS;
        candidate.recognizedStatus = 'pickup_scheduled';
      }
    } else if (
      raw === 'MSHC' &&
      returning &&
      candidate.recognizedStatus === 'out_for_delivery'
    ) {
      // After the return began, a delivery-run scan is the parcel heading back
      // to the sender, not out for delivery to the customer.
      event.status = 'in_transit';
      event.rawStatus = candidate.providerStatus;
      candidate.recognizedStatus = 'in_transit';
    }
    if (
      raw === 'MSHC' &&
      candidate.recognizedStatus === 'out_for_delivery' &&
      event.rawStatus === GIGL_PICKUP_EN_ROUTE_RAW_STATUS
    ) {
      // A genuine delivery run (after arrival or network movement) must not keep
      // the pickup-en-route raw status the normalizer derived from the reason.
      event.rawStatus = candidate.providerStatus;
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
    // A located pickup away from the destination also proves the parcel left
    // it, without counting as network movement for the MSHC guard above.
    if (
      candidate.recognizedStatus === 'picked_up' &&
      // A pickup inside a known same-city origin proves nothing about leaving.
      !originIsDestination &&
      placeWords(event.location).length > 0 &&
      !matchesDestination(event.location, destination)
    ) {
      leftDestinationCentre = true;
    }
  }
}
