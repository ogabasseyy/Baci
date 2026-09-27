import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Maps fulfillment action statuses onto canonical shipping statuses,
 * mirroring the sync-time mapping for these three outcomes.
 */
function mapActionStatusToCanonicalShippingStatus(
  status: string
): 'processing' | 'shipped' | 'cancelled' {
  const normalized = status.toLowerCase();
  if (normalized.includes('cancel')) return 'cancelled';
  if (normalized.includes('ready') || normalized.includes('ship')) {
    return 'shipped';
  }
  return 'processing';
}

/**
 * Persists a fulfillment action outcome locally. Updates the Jumia cache
 * row and, when it is linked to a canonical order, the canonical row the
 * dashboard displays. The two writes are sequential rather than atomic;
 * each failure is reported as a sync warning so the merchant knows the
 * provider state and the local state may differ.
 */
export async function updateJumiaActionOrderStatus(
  supabase: SupabaseClient,
  orderId: string,
  merchantId: string,
  newStatus: string
): Promise<{ syncWarning: string; details: string } | undefined> {
  const { data: updated, error } = await supabase
    .from('jumia_orders')
    .update({ status: newStatus })
    .eq('jumia_order_id', orderId)
    .eq('merchant_id', merchantId)
    .select('baci_order_id');

  if (error) {
    logger.error({
      message: `Failed to update order status to ${newStatus}`,
      error,
      orderId,
    });
    return { syncWarning: 'Failed to update local DB', details: error.message };
  }

  const baciOrderId = updated?.[0]?.baci_order_id;
  if (typeof baciOrderId !== 'string' || baciOrderId.length === 0) {
    return undefined;
  }

  const { error: canonicalError } = await supabase
    .from('orders')
    .update({
      shipping_status: mapActionStatusToCanonicalShippingStatus(newStatus),
    })
    .eq('id', baciOrderId)
    .eq('merchant_id', merchantId);

  if (canonicalError) {
    logger.error({
      message: `Failed to update canonical order status to ${newStatus}`,
      error: canonicalError,
      orderId,
      baciOrderId,
    });
    return {
      syncWarning: 'Failed to update canonical order',
      details: canonicalError.message,
    };
  }
  return undefined;
}
