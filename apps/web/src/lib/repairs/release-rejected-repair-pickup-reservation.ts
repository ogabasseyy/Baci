import type { SupabaseClient } from '@supabase/supabase-js';

export async function releaseRejectedRepairPickupReservation(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string,
  shipmentId: string,
  lockToken: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'release_rejected_repair_pickup_reservation',
    {
      p_lock_token: lockToken,
      p_merchant_id: merchantId,
      p_repair_id: repairId,
      p_shipment_id: shipmentId,
    }
  );

  if (error || data !== true) {
    console.error(
      'Failed to release rejected repair pickup reservation:',
      error
    );
    return false;
  }

  return true;
}
