import type { SupabaseClient } from '@supabase/supabase-js';

export async function reconcileLinkedRepairPickup(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string,
  shipmentId: string
): Promise<boolean> {
  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, provider_shipment_id, tracking_number')
    .eq('id', shipmentId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (
    shipmentError ||
    !shipment?.provider_shipment_id ||
    !shipment.tracking_number
  ) {
    return false;
  }

  const { error } = await supabase
    .from('repairs')
    .update({
      pickup_booking_lock_token: null,
      pickup_booking_started_at: null,
      pickup_payment_status: 'booked',
    })
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .eq('shipment_id', shipmentId);

  return !error;
}
