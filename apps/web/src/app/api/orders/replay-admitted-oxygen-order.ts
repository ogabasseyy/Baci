import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { toFiniteNumber } from '@/lib/immediate-order/order-item-primitives';

import { checkoutOrderNotReusable } from './checkout-order-not-reusable';

const closedShippingStatuses = [
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'completed',
  'cancelled',
  'canceled',
  'returned',
  'refunded',
];

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
  // carries no workflow identifier or provider state. A changed merchant
  // binding can block new applications without hiding a saved NGN order.
  const { data, error } = await client
    .from('orders')
    .select(
      'id,order_number,total,payment_status,payment_method,currency,shipping_status,created_at,tracking_token,amount_paid,cancelled_at,customers!inner(user_id,merchant_id)'
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
  const { customers: _owner, amount_paid, cancelled_at, ...order } = data;
  const total = toFiniteNumber(order.total);
  const paid = toFiniteNumber(amount_paid ?? 0);
  if (
    cancelled_at ||
    order.payment_status !== 'unpaid' ||
    order.currency !== 'NGN' ||
    closedShippingStatuses.includes(order.shipping_status) ||
    total === null ||
    total <= 0 ||
    paid === null
  )
    return checkoutOrderNotReusable();
  return NextResponse.json(
    {
      order: { ...order, total },
      wallet: null,
      savings: null,
      amountDueToGateway: Math.max(total - paid, 0),
      idempotency: { replayed: true },
    },
    { headers: { 'x-idempotency-replayed': 'true' } }
  );
}
