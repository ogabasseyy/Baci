import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { giglProvider } from '@/lib/shipping/providers/gigl';
import type { TrackingResult } from '@/lib/shipping/types';
import type { Database, Json } from '@/types/supabase';
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

type WorkerSupabase = SupabaseClient<Database>;
type TrackShipments = (
  trackingNumbers: readonly string[]
) => Promise<Map<string, TrackingResult>>;

const UNRECOGNIZED_LIFECYCLE_ERROR =
  'GIGL tracking result has no recognized lifecycle event';

function serializeEvents(events: TrackingResult['events']): Json {
  return events.map((event) => ({
    description: event.description,
    location: event.location ?? null,
    normalized_status: event.status,
    occurred_at: event.timestamp.toISOString(),
    provider_event_id: event.providerEventId ?? null,
    provider_event_key: event.providerEventKey ?? event.providerEventId ?? null,
    raw_status: event.rawStatus ?? event.status,
  }));
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
  result: TrackingResult
) {
  const { data, error } = await supabase.rpc('apply_gigl_tracking_result', {
    p_actual_delivery: nullableSupabaseRpcArgument(
      result.actualDelivery?.toISOString() ?? null
    ),
    p_current_location: nullableSupabaseRpcArgument(
      result.events[0]?.location ?? null
    ),
    p_events: serializeEvents(result.events),
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
    giglProvider.trackShipments(trackingNumbers)
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

  await Promise.all(
    monitors.map(async (monitor) => {
      const result = results.get(monitor.tracking_number);
      try {
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
        const applied = await applyResult(supabase, monitor, workerId, result);
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
