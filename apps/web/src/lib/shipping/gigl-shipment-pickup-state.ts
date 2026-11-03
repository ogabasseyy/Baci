import type { SupabaseClient } from '@supabase/supabase-js';

const UNPICKED_STATUSES = new Set(['pending', 'booked', 'pickup_scheduled']);

/**
 * True while an order's live GIG shipment is booked but the parcel has not
 * been collected. The customer's "shipped" notification waits for GIG's
 * picked_up event, so callers suppress the early one for these orders.
 * Fails open: a lookup error must never swallow a shipped alert.
 */
export async function hasUnpickedGiglShipment(
  supabase: SupabaseClient,
  orderId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('shipments')
    .select('status')
    .eq('order_id', orderId)
    .eq('provider', 'GIGL')
    .neq('status', 'cancelled');
  if (error || !data) return false;
  return data.some((row) => UNPICKED_STATUSES.has(row.status ?? ''));
}

/**
 * The customer "shipped" push for a GIG order waits for GIG's picked_up event.
 * Non-GIG and self-fulfilled orders, and every other status, are unchanged.
 */
export async function shouldDeferShippedNotificationToGigPickup(
  supabase: SupabaseClient,
  orderId: string,
  shippingStatus: string
): Promise<boolean> {
  return (
    shippingStatus === 'shipped' &&
    (await hasUnpickedGiglShipment(supabase, orderId))
  );
}
