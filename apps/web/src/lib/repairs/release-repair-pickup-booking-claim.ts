import type { SupabaseClient } from '@supabase/supabase-js';

export async function releaseRepairPickupBookingClaim(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string,
  lockToken: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'release_repair_pickup_booking_claim',
    {
      p_lock_token: lockToken,
      p_merchant_id: merchantId,
      p_repair_id: repairId,
    }
  );

  if (error || data !== true) {
    console.error('Failed to release repair pickup booking claim:', error);
    return false;
  }

  return true;
}
