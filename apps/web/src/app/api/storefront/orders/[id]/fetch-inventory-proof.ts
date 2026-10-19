import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-confirmed inventory bit for the storefront order lookup: the
 * status poll gates confirmation on this instead of the approved
 * status alone (the webhook writes approval before inventory
 * confirmation lands, and a slow confirmation can span poll
 * intervals). The narrow RPC authorizes by creation tracking token,
 * order email, customer ownership, or merchant view; a lookup
 * failure reads as not confirmed (fail closed — the poll keeps
 * polling).
 */
export async function fetchOrderInventoryProof(
  supabase: Pick<SupabaseClient, 'rpc'>,
  orderId: string,
  trackingToken: string | null,
  email: string | null = null
): Promise<boolean> {
  const { data } = await supabase.rpc('get_order_inventory_proof', {
    p_order_id: orderId,
    p_tracking_token: trackingToken,
    p_email: email,
  });
  return data === true;
}
