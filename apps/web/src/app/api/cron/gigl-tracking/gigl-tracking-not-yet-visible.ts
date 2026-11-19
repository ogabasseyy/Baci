import { GIGL_WAYBILL_NOT_YET_VISIBLE } from './gigl-tracking-not-yet-visible.constants';

type QuietPollMonitor = {
  shipment_id: string;
  tracking_epoch_id: string;
};

export type QuietPollFailureArgs = {
  p_error: string;
  p_shipment_id: string;
  p_tracking_epoch_id: string;
  p_worker_id: string;
};

export interface QuietPollSupabaseClient {
  rpc(
    fn: 'record_gigl_tracking_failure',
    args: QuietPollFailureArgs
  ): PromiseLike<{ error: { message?: string } | null }>;
}

/**
 * Records a quiet poll when GIG omits an un-scanned booked waybill from
 * batch tracking so back-off advances without counting a provider failure.
 */
export async function recordNotYetVisible(
  supabase: QuietPollSupabaseClient,
  monitor: QuietPollMonitor,
  workerId: string
): Promise<void> {
  const { error } = await supabase.rpc('record_gigl_tracking_failure', {
    p_error: GIGL_WAYBILL_NOT_YET_VISIBLE,
    p_shipment_id: monitor.shipment_id,
    p_tracking_epoch_id: monitor.tracking_epoch_id,
    p_worker_id: workerId,
  });
  if (error) {
    throw new Error('Failed to record GIGL waybill as not yet visible');
  }
}
