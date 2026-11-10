import { mapKnownGiglStatus } from '@baci/shared/lib/gigl-tracking-status';
import type { GiglWaybillCancellation } from '@/lib/shipping/providers/gigl.preshipment-cancellation';
import type { TrackingResult } from '@/lib/shipping/types';

export type ReadWaybillCancellation = (
  trackingNumber: string
) => Promise<GiglWaybillCancellation>;

// GIG shows an app-side cancellation only on the preshipment record, never in
// the track feed. These statuses are already terminal in the feed, so no
// extra GIG call is spent on them. 'failed' is deliberately NOT here: GIG
// can still cancel a failed-delivery waybill, so it keeps being checked.
const FEED_TERMINAL = new Set(['delivered', 'cancelled', 'returned']);

export function needsPreshipmentCancellationRead(
  result: TrackingResult | undefined
): boolean {
  return !result || !FEED_TERMINAL.has(result.status);
}

/**
 * Folds a preshipment cancellation into the tracking result as one synthetic
 * event, normalised through the shared GIG status map, so the existing
 * cancel/refund path (attestation + apply_gigl_tracking_result) runs. The
 * database trigger then treats it exactly like a feed 'SSC': it only sets the
 * order's shipping_status, and only for the latest shipment generation.
 */
export function withPreshipmentCancellation(
  result: TrackingResult | undefined,
  trackingNumber: string,
  observedAt: Date
): TrackingResult {
  const status = mapKnownGiglStatus('CANCELLED') ?? 'cancelled';
  return {
    carrierName: 'GIG Logistics',
    ...result,
    provider: 'GIGL',
    trackingNumber,
    hasRecognizedLifecycleEvent: true,
    estimatedDelivery: undefined,
    actualDelivery: undefined,
    status,
    events: [
      {
        description: 'Shipment cancelled in GIG',
        location: result?.events[0]?.location,
        providerEventKey: `preshipment-cancelled:${trackingNumber}`,
        rawStatus: 'CANCELLED',
        status,
        timestamp: observedAt,
      },
      ...(result?.events ?? []),
    ],
  };
}
