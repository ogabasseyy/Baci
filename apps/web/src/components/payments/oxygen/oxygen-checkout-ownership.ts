import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function ownsOxygenCheckoutOrder(
  value: unknown,
  orderId: string,
  merchantId: string,
  customerId: string,
  userId: string
): boolean {
  const order = record(value);
  const customer = record(order?.customers);
  return (
    order?.id === orderId &&
    order.merchant_id === merchantId &&
    order.payment_method === 'oxygen' &&
    order.customer_id === customerId &&
    customer?.id === customerId &&
    customer.merchant_id === merchantId &&
    customer.user_id === userId
  );
}

/** Read only identifiers before selecting checkout contact or order details. */
export async function readOwnedOxygenCustomerId(
  client: SupabaseClient,
  orderId: string,
  merchantId: string,
  userId: string
): Promise<string | null> {
  const orderResult = await client
    .from('orders')
    .select('id, customer_id, merchant_id, payment_method')
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .eq('payment_method', 'oxygen')
    .maybeSingle();
  const order = record(orderResult.data);
  if (
    orderResult.error ||
    order?.id !== orderId ||
    order.merchant_id !== merchantId ||
    order.payment_method !== 'oxygen' ||
    typeof order.customer_id !== 'string' ||
    !order.customer_id
  )
    return null;
  const customerResult = await client
    .from('customers')
    .select('id, merchant_id, user_id')
    .eq('id', order.customer_id)
    .eq('merchant_id', merchantId)
    .eq('user_id', userId)
    .maybeSingle();
  const customer = record(customerResult.data);
  return !customerResult.error &&
    customer?.id === order.customer_id &&
    customer.merchant_id === merchantId &&
    customer.user_id === userId
    ? order.customer_id
    : null;
}
