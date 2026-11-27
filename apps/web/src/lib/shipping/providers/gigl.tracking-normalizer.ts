import { createHash } from 'node:crypto';
// Direct leaf import, not the `@baci/shared/lib` barrel: the poller
// runtime evaluates every barrel re-export, which would make each
// shared-util edit a worker change. The leaf keeps the tracked worker
// graph to exactly what the poller executes.
import { mapKnownGiglStatus } from '@baci/shared/lib/gigl-tracking-status';
import type { z } from 'zod';
import {
  GIGL_ARRIVED_IN_CITY_RAW_STATUS,
  GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
} from '@/lib/shipping/gigl-tracking-notification-policy-matrix';
import type { TrackingEvent, TrackingResult } from '../types';
import {
  GIGL_TRACKING_MAX_FUTURE_SKEW_MS,
  PickupOptions,
} from './gigl.constants';
import type { giglSchemas } from './gigl.schemas';
import { resolveAggregate } from './gigl.tracking-aggregate';
import { applyLifecycleGuards } from './gigl.tracking-lifecycle-guards';
import { currentStatusRank } from './gigl.tracking-status-rank';

type GiglTrackingShipment = z.input<typeof giglSchemas.trackingShipment>;

const timezoneSuffixPattern = /(?:Z|[+-]\d{2}:\d{2})$/i;
const bareIsoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;

function parseGiglTrackingTimestamp(value: string, isUtc: boolean): Date {
  const trimmed = value.trim();
  const normalized = trimmed.endsWith(' WAT')
    ? `${trimmed.slice(0, -4).replace(' ', 'T')}+01:00`
    : isUtc && bareIsoDateTimePattern.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed;
  if (!timezoneSuffixPattern.test(normalized)) {
    throw new Error('GIGL tracking timestamp has no timezone');
  }
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('GIGL tracking timestamp is invalid');
  }
  return timestamp;
}

function fallbackProviderEventKey(
  waybill: string,
  rawStatus: string,
  timestamp: Date,
  location: string | undefined,
  scanStatusReason: string | undefined,
  scanStatusIncident: string | undefined
): string {
  const tuple = JSON.stringify([
    waybill,
    rawStatus,
    timestamp.toISOString(),
    location ?? '',
    scanStatusReason ?? '',
    scanStatusIncident ?? '',
  ]);
  return `fallback:${createHash('sha256').update(tuple).digest('hex')}`;
}

export function normalizeGiglTrackingShipment(
  shipment: GiglTrackingShipment,
  requestedWaybill: string,
  observedAt: Date
): TrackingResult {
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error('GIGL tracking observation timestamp is invalid');
  }

  const normalizedRequestedWaybill = requestedWaybill.trim();
  const responseWaybill = shipment.Waybill?.trim();
  if (responseWaybill && responseWaybill !== normalizedRequestedWaybill) {
    throw new Error('GIGL tracking waybill does not match requested waybill');
  }
  const waybill = responseWaybill || normalizedRequestedWaybill;
  const candidates = (shipment.MobileShipmentTrackings ?? []).flatMap(
    (event) => {
      try {
        const dateTimeUtc = event.DateTimeUtc?.trim();
        const timestampSource = dateTimeUtc || event.DateTime?.trim();
        if (!timestampSource) {
          throw new Error('GIGL tracking event has no timestamp');
        }
        const timestamp = parseGiglTrackingTimestamp(
          timestampSource,
          Boolean(dateTimeUtc)
        );
        if (
          timestamp.getTime() >
          observedAt.getTime() + GIGL_TRACKING_MAX_FUTURE_SKEW_MS
        ) {
          throw new Error(
            'GIGL tracking event timestamp is too far in the future'
          );
        }

        const rawStatus = event.Status.trim();
        const scanStatusReason = event.ScanStatusReason?.trim();
        const scanStatusIncident = event.ScanStatusIncident?.trim();
        const scanStatusComment = event.ScanStatusComment?.trim();
        const hasPickupEnRouteReason = [
          scanStatusReason,
          scanStatusIncident,
        ].some(
          (value) => value?.toUpperCase() === GIGL_PICKUP_EN_ROUTE_RAW_STATUS
        );
        const notificationRawStatus = hasPickupEnRouteReason
          ? GIGL_PICKUP_EN_ROUTE_RAW_STATUS
          : rawStatus;
        const location =
          event.Location?.trim() ||
          event.DepartureServiceCentre?.Name?.trim() ||
          event.DepartureServiceCentre?.Address?.trim() ||
          undefined;
        const description = scanStatusReason || scanStatusIncident || rawStatus;
        const recognizedStatus =
          mapKnownGiglStatus(rawStatus) ??
          (scanStatusReason ? mapKnownGiglStatus(scanStatusReason) : null) ??
          (scanStatusIncident ? mapKnownGiglStatus(scanStatusIncident) : null);
        const providerEventId =
          event.ShipmentTrackingId ?? event.MobileShipmentTrackingId;
        const providerEventKey =
          event.ShipmentTrackingId != null
            ? `shipment:${String(event.ShipmentTrackingId)}`
            : event.MobileShipmentTrackingId != null
              ? `mobile:${String(event.MobileShipmentTrackingId)}`
              : fallbackProviderEventKey(
                  waybill,
                  rawStatus,
                  timestamp,
                  location,
                  scanStatusReason,
                  scanStatusIncident
                );

        return [
          {
            event: {
              description,
              location,
              providerEventId:
                providerEventId != null ? String(providerEventId) : undefined,
              providerEventKey,
              rawStatus: notificationRawStatus,
              status: recognizedStatus ?? 'pending',
              timestamp,
            } satisfies TrackingEvent,
            recognizedStatus,
            providerStatus: rawStatus,
            scanText: [scanStatusReason, scanStatusIncident, scanStatusComment]
              .filter(Boolean)
              .join(' '),
          },
        ];
      } catch {
        return [];
      }
    }
  );

  applyLifecycleGuards(
    candidates,
    shipment.Destination ?? undefined,
    shipment.Origin ?? undefined
  );

  const sortedCandidates = [...candidates].sort(
    (left, right) =>
      right.event.timestamp.getTime() - left.event.timestamp.getTime() ||
      currentStatusRank(right) - currentStatusRank(left)
  );
  if (sortedCandidates.length === 0) {
    throw new Error('GIGL tracking result has no valid tracking events');
  }
  const hasRecognizedLifecycleEvent = sortedCandidates.some(
    (candidate) => candidate.recognizedStatus !== null
  );
  const { status, lead } = resolveAggregate(sortedCandidates);
  // The worker reads the current location from events[0]; a same-time scan
  // (e.g. MSHC, with or without its own location) must not hide the arrival
  // centre from the same poll.
  // The event that will lead the list (see resolveAggregate) owns the snapshot.
  const top = lead ?? sortedCandidates[0];
  // A located leader keeps its own location (terminal, failed...) except the
  // generic MSHC, whose hub is not where the parcel is: the arrival wins there.
  const topKeepsOwnLocation =
    Boolean(top?.event.location) &&
    top?.providerStatus.trim().toUpperCase() !== 'MSHC';
  if (top && !topKeepsOwnLocation) {
    const tied = sortedCandidates.filter(
      (candidate) =>
        candidate.event.location &&
        candidate.event.timestamp.getTime() === top.event.timestamp.getTime()
    );
    // Only the verified arrival case: a tied arrival scan's location is the
    // current one. Never copy a hub's location onto an unrelated leading event
    // (e.g. a location-less delivered scan).
    const located = tied.find(
      (candidate) =>
        candidate.event.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
    if (located && located !== top) top.event.location = located.event.location;
  }
  const deliveredEvent = sortedCandidates.find(
    (candidate) => candidate.recognizedStatus === 'delivered'
  );

  return {
    provider: 'GIGL',
    trackingNumber: waybill,
    status,
    carrierName: 'GIG Logistics',
    hasRecognizedLifecycleEvent,
    actualDelivery:
      status === 'delivered' ? deliveredEvent?.event.timestamp : undefined,
    events: (lead
      ? [lead, ...sortedCandidates.filter((candidate) => candidate !== lead)]
      : sortedCandidates
    ).map((candidate) => candidate.event),
    isStationPickup: shipment.PickupOptions === PickupOptions.ServiceCentre,
  };
}
