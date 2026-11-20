import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function replayAdmittedOxygenOrder({
  client,
  merchantId,
  userId,
  key,
  hash,
  rejection,
}: {
  client: SupabaseClient;
  merchantId: string;
  userId: string | null;
  key: string | null;
  hash: string | null;
  rejection: NextResponse;
}): Promise<NextResponse> {
  if (!userId || !key || !hash) return rejection;
  // Checkout keys and request hashes belong to the order. The Oxygen
  // environment is bound when its financing workflow starts. This response
  // carries no workflow identifier or provider state.
  const { data, error } = await client
    .from('orders')
    .select(
      'id,order_number,total,payment_status,payment_method,currency,shipping_status,created_at,tracking_token,amount_paid,customers!inner(user_id,merchant_id)'
    )
    .eq('merchant_id', merchantId)
    .eq('customers.merchant_id', merchantId)
    .eq('customers.user_id', userId)
    .eq('checkout_idempotency_key', key)
    .eq('checkout_request_hash', hash)
    .eq('payment_method', 'oxygen')
    .maybeSingle();
  if (error || !data) return rejection;

  // An exact existing order can be reported, even during a rollout pause. The
  // denied admission never reaches the create RPC or its replay mutations.
  const { customers: _owner, amount_paid, ...order } = data;
  return NextResponse.json(
    {
      order,
      wallet: null,
      savings: null,
      amountDueToGateway:
        order.payment_status === 'unpaid'
          ? Math.max(order.total - (amount_paid ?? 0), 0)
          : 0,
      idempotency: { replayed: true },
    },
    { headers: { 'x-idempotency-replayed': 'true' } }
  );
}
