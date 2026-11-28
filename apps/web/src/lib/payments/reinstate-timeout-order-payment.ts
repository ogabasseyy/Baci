import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshReclaimedOrderInventory } from './ensure-paid-order-inventory-confirmed';

/** Call only after the gateway capture and its evidence have been persisted. */
export async function reinstateTimeoutOrderPayment(
  supabase: SupabaseClient,
  orderId: string,
  transactionId: string,
  merchantId: string
): Promise<'reinstated' | 'already_reinstated' | 'blocked'> {
  const { data: orderIdentity, error: identityError } = await supabase
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (identityError) {
    throw new Error('Late payment merchant validation failed', {
      cause: identityError,
    });
  }
  if (!orderIdentity) return 'blocked';

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
