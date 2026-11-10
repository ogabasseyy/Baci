import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { giglProvider } from '@/lib/shipping/providers/gigl';
import type { GiglWaybillOwnership } from '@/lib/shipping/providers/gigl.preshipment-ownership';
import type { TrackingResult } from '@/lib/shipping/types';
import type { Database, Json } from '@/types/supabase';
import {
  needsPreshipmentCancellationRead,
  type ReadWaybillCancellation,
  withPreshipmentCancellation,
} from './gigl-tracking-preshipment-cancellation';
import { nullableSupabaseRpcArgument } from './nullable-supabase-rpc-argument';

const claimedMonitorSchema = z.object({
  // Repair-pickup monitors enroll with null order_id; identity is shipment/epoch.
  order_id: z.string().uuid().nullable(),
  shipment_id: z.string().uuid(),
  state: z.enum(['active', 'final_poll', 'paused']),
  tracking_epoch_id: z.string().uuid(),
  tracking_number: z.string().trim().min(1).max(128),
});

export const claimedGiglTrackingMonitorsSchema = z.array(claimedMonitorSchema);
export type ClaimedGiglTrackingMonitor = z.infer<typeof claimedMonitorSchema>;

export type GiglTrackingMonitorSummary = {
  applied: number;
  claimed: number;
  failed: number;
  paused: number;
  success: true;
};

type WorkerSupabase = Pick<SupabaseClient<Database>, 'rpc'>;
type TrackShipments = (
  trackingNumbers: readonly string[]
) => Promise<Map<string, TrackingResult>>;
type AttestWaybillOwnership = (
  trackingNumber: string
) => Promise<GiglWaybillOwnership>;

const UNRECOGNIZED_LIFECYCLE_ERROR =
  'GIGL tracking result has no recognized lifecycle event';

// The database refunds a merchant-wallet GIGL charge on GIG's cancellation
// only when this worker marks the cancellation events "account_attested":
// GIG's preshipment record shows the waybill belongs to Baci's own GIG
// account, so a decoy waybill from a merchant's own account never refunds.
function serializeEvents(
  events: TrackingResult['events'],
  accountAttested: boolean
): Json {
  return events.map((event) => ({
    description: event.description,
    location: event.location ?? null,
    normalized_status: event.status,
    occurred_at: event.timestamp.toISOString(),
    provider_event_id: event.providerEventId ?? null,
    provider_event_key: event.providerEventKey ?? event.providerEventId ?? null,
    raw_status: event.rawStatus ?? event.status,
    ...(accountAttested && event.status === 'cancelled'
      ? { account_attested: true }
      : {}),
  }));
}

// Only cancellations need the extra GIG lookup (rare); one lookup per
// waybill per batch. Only a definite 'owned' attests. 'not_owned', an
// 'unavailable' answer and a thrown lookup all apply the cancellation
// unattested, so cancellations with no merchant-wallet charge (customer
// checkout, prepaid, orderless repair pickups) are never blocked by GIG.
// A booked wallet charge that is not refunded makes the database guard
// raise 55P03, the apply rolls back and the normal failure/backoff path
// retries; a later poll re-runs this lookup and self-heals once GIG answers.
function createCancellationAttestor(attest: AttestWaybillOwnership) {
  const lookups = new Map<string, Promise<GiglWaybillOwnership>>();
  return async (
    result: TrackingResult,
    trackingNumber: string
  ): Promise<boolean> => {
    if (result.status !== 'cancelled') return false;
    let lookup = lookups.get(trackingNumber);
    if (!lookup) {
      lookup = Promise.resolve()
        .then(() => attest(trackingNumber))
        .then(
          (ownership): GiglWaybillOwnership =>
            ownership === 'owned' || ownership === 'not_owned'
              ? ownership
              : 'unavailable',
          (): GiglWaybillOwnership => 'unavailable'
        );
      lookups.set(trackingNumber, lookup);
    }
    const ownership = await lookup;
    return ownership === 'owned';
  };
}

async function recordFailure(
  supabase: WorkerSupabase,
  monitor: ClaimedGiglTrackingMonitor,
  workerId: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : 'unknown_error';
  const { error: rpcError } = await supabase.rpc(
    'record_gigl_tracking_failure',
    {
      p_error: message,
      p_shipment_id: monitor.shipment_id,
      p_tracking_epoch_id: monitor.tracking_epoch_id,
      p_worker_id: workerId,
    }
  );
  if (rpcError) throw rpcError;
}

async function applyResult(
  supabase: WorkerSupabase,
  monitor: ClaimedGiglTrackingMonitor,
  workerId: string,
  result: TrackingResult,
  accountAttested: boolean
) {
  const { data, error } = await supabase.rpc('apply_gigl_tracking_result', {
    p_actual_delivery: nullableSupabaseRpcArgument(
      result.actualDelivery?.toISOString() ?? null
    ),
    p_current_location: nullableSupabaseRpcArgument(
      result.events[0]?.location ?? null
    ),
    p_events: serializeEvents(result.events, accountAttested),
    p_shipment_id: monitor.shipment_id,
    p_status: result.status,
    p_tracking_epoch_id: monitor.tracking_epoch_id,
    p_worker_id: workerId,
  });
  if (error) throw error;
  return data;
}

async function releaseClaim(
  supabase: WorkerSupabase,
  monitor: ClaimedGiglTrackingMonitor,
  workerId: string
) {
  const { error } = await supabase.rpc('release_gigl_tracking_claim', {
    p_shipment_id: monitor.shipment_id,
    p_tracking_epoch_id: monitor.tracking_epoch_id,
    p_worker_id: workerId,
  });
  if (error) throw error;
}

async function pauseMonitor(
  supabase: WorkerSupabase,
  monitor: ClaimedGiglTrackingMonitor,
  workerId: string
) {
  const { data, error } = await supabase.rpc('pause_gigl_tracking_monitor', {
    p_error: UNRECOGNIZED_LIFECYCLE_ERROR,
    p_shipment_id: monitor.shipment_id,
    p_tracking_epoch_id: monitor.tracking_epoch_id,
    p_worker_id: workerId,
  });
  if (error) throw error;
  return data;
}

export async function processClaimedGiglTrackingMonitors(
  supabase: WorkerSupabase,
  monitors: ClaimedGiglTrackingMonitor[],
  workerId: string,
  trackShipments: TrackShipments = (trackingNumbers) =>
    giglProvider.trackShipments(trackingNumbers),
  attestWaybillOwnership: AttestWaybillOwnership = (trackingNumber) =>
    giglProvider.attestWaybillOwnership(trackingNumber),
  readWaybillCancellation: ReadWaybillCancellation = (trackingNumber) =>
    giglProvider.readWaybillCancellation(trackingNumber)
): Promise<GiglTrackingMonitorSummary> {
  const summary: GiglTrackingMonitorSummary = {
    applied: 0,
    claimed: monitors.length,
    failed: 0,
    paused: 0,
    success: true,
  };
  if (monitors.length === 0) return summary;

  let results: Map<string, TrackingResult>;
  try {
    const trackingNumbers = [
      ...new Set(monitors.map((monitor) => monitor.tracking_number)),
    ];
    results = await trackShipments(trackingNumbers);
  } catch (error) {
    await Promise.all(
      monitors.map(async (monitor) => {
        await recordFailure(supabase, monitor, workerId, error);
        summary.failed += 1;
      })
    );
    return summary;
  }

  const attestCancellation = createCancellationAttestor(attestWaybillOwnership);
  const cancellationReads = new Map<
    string,
    ReturnType<ReadWaybillCancellation>
  >();
  const readCancellationOnce: ReadWaybillCancellation = (trackingNumber) => {
    let read = cancellationReads.get(trackingNumber);
    if (!read) {
      read = readWaybillCancellation(trackingNumber);
      cancellationReads.set(trackingNumber, read);
    }
    return read;
  };
  await Promise.all(
    monitors.map(async (monitor) => {
      let result = results.get(monitor.tracking_number);
      try {
        if (needsPreshipmentCancellationRead(result)) {
          const cancellation = await readCancellationOnce(
            monitor.tracking_number
          ).catch(() => 'unknown' as const);
          if (cancellation === 'cancelled') {
            result = withPreshipmentCancellation(
              result,
              monitor.tracking_number,
              new Date()
            );
          }
        }
        if (!result)
          throw new Error('GIGL batch tracking omitted claimed waybill');
        if (result.hasRecognizedLifecycleEvent === false) {
          const paused = await pauseMonitor(supabase, monitor, workerId);
          if (paused) {
            summary.paused += 1;
            return;
          }
          await releaseClaim(supabase, monitor, workerId);
          throw new Error(UNRECOGNIZED_LIFECYCLE_ERROR);
        }
        const accountAttested = await attestCancellation(
          result,
          monitor.tracking_number
        );
        const applied = await applyResult(
          supabase,
          monitor,
          workerId,
          result,
          accountAttested
        );
        if (applied) {
          summary.applied += 1;
        } else {
          await releaseClaim(supabase, monitor, workerId);
        }
      } catch (error) {
        logger.error({
          message: 'Failed to apply GIGL tracking result',
          shipmentId: monitor.shipment_id,
          error,
        });
        await recordFailure(supabase, monitor, workerId, error);
        summary.failed += 1;
      }
    })
  );
  return summary;
}
