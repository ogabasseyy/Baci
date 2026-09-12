import type { SupabaseClient } from '@supabase/supabase-js';

export async function abandonUnlinkedRepairPickupShipment(
  supabase: SupabaseClient,
  merchantId: string,
  shipmentId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('shipments')
    .delete()
    .eq('id', shipmentId)
    .eq('merchant_id', merchantId)
    .is('order_id', null)
    .is('provider_shipment_id', null)
    .is('tracking_number', null)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    console.error('Failed to abandon unlinked repair pickup shipment:', error);
    return false;
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.error(
      'Failed to abandon unlinked repair pickup shipment: no matching pending shipment'
    );
    return false;
  }

  return true;
}
