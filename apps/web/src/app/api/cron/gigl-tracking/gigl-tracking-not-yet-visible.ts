import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// GIG's batch tracking returns nothing for a booked waybill until the rider
// scans it at pickup. That is "not visible yet", not a failure: the database
// recognises this exact marker on record_gigl_tracking_failure as a quiet
// poll (no failure count, no error alert), and its back-off ladder then lets
// the monitor go dormant until a GIG webhook or the safety check wakes it.
// Reusing the existing lease-bound RPC keeps the worker's capability set
// unchanged. Keep this text in sync with the migration
// 20261118092500_gigl_tracking_trigger_driven_polling.sql.
export const GIGL_WAYBILL_NOT_YET_VISIBLE = 'GIGL waybill not yet visible';

type QuietPollMonitor = {
  shipment_id: string;
  tracking_epoch_id: string;
};

/**
 * Records a quiet poll when GIG omits an un-scanned booked waybill from
 * batch tracking so back-off advances without counting a provider failure.
 */
export async function recordNotYetVisible(
  supabase: Pick<SupabaseClient<Database>, 'rpc'>,
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
