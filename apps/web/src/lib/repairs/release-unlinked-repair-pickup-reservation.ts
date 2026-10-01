import type { SupabaseClient } from '@supabase/supabase-js';
import { abandonUnlinkedRepairPickupShipment } from '@/lib/repairs/abandon-unlinked-repair-pickup-shipment';
import type { PickupFailureReason } from '@/lib/repairs/pickup-shipment-utils';
import { releaseRepairPickupBookingClaim } from '@/lib/repairs/release-repair-pickup-booking-claim';

export async function releaseUnlinkedRepairPickupReservation(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string,
  shipmentId: string,
  lockToken: string
): Promise<
  Extract<PickupFailureReason, 'booking_failed' | 'shipment_save_failed'>
> {
  const abandoned = await abandonUnlinkedRepairPickupShipment(
    supabase,
    merchantId,
    shipmentId
  );
  if (!abandoned) {
    // Keep the claim so webhook retries cannot create another orphaned shipment.
    return 'shipment_save_failed';
  }

  await releaseRepairPickupBookingClaim(
    supabase,
    merchantId,
    repairId,
    lockToken
  );
  return 'booking_failed';
}
