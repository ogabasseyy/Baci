import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Terminal after() delivery (invoice artifacts built and proforma
 * emailed) for the signed-in order lookup: signed-in success screens
 * gate invoice_generated on this exactly like the guest/token branch.
 * The claims table stays RLS-denied to session callers, so the narrow
 * ownership-checked RPC supplies the bit; a lookup failure reads as
 * not delivered (the bounded refresh lane retries).
 */
export async function fetchAuthenticatedDeliveryFlag(
  supabase: Pick<SupabaseClient, 'rpc'>,
  orderId: string
): Promise<boolean> {
  const { data } = await supabase.rpc('get_order_notification_delivered', {
    p_order_id: orderId,
  });
  return data === true;
}
