import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshReclaimedOrderInventory } from './ensure-paid-order-inventory-confirmed';

/** Call only after the gateway capture and its evidence have been persisted. */
export async function reinstateTimeoutOrderPayment(
  supabase: SupabaseClient,
  orderId: string,
  transactionId: string,
  merchantId: string
): Promise<'reinstated' | 'already_reinstated' | 'blocked'> {
  const { data, error } = await supabase.rpc(
    'reinstate_timeout_order_payment',
    {
      p_order_id: orderId,
      p_transaction_id: transactionId,
    }
  );
  if (error) {
    throw new Error('Late payment reinstatement failed', { cause: error });
  }
  if (data === 'reinstated_inventory_reclaimed') {
    refreshReclaimedOrderInventory(supabase, merchantId, orderId);
    return 'reinstated';
  }
  if (
    data === 'reinstated' ||
    data === 'already_reinstated' ||
    data === 'blocked'
  ) {
    return data;
  }
  throw new Error('Late payment reinstatement returned an invalid result');
}
