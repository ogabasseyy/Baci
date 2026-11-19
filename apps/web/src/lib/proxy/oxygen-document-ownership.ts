import type { SupabaseClient } from '@supabase/supabase-js';

function row(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/**
 * Checks only public/RLS projections; trustedMerchantSlug must come from the
 * routing stage, not a client-supplied header or arbitrary query parameter.
 */
export async function verifyOxygenDocumentOwnership(
  client: SupabaseClient,
  orderId: string,
  trustedMerchantSlug: string
): Promise<boolean> {
  if (!trustedMerchantSlug) return false;
  try {
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return false;
    const orderResult = await client
      .from('orders')
      .select('id,merchant_id,customer_id,payment_method')
      .eq('id', orderId)
      .maybeSingle();
    const order = row(orderResult.data);
    if (
      orderResult.error ||
      order?.id !== orderId ||
      order.payment_method !== 'oxygen' ||
      typeof order.merchant_id !== 'string' ||
      typeof order.customer_id !== 'string'
    )
      return false;
    const customerResult = await client
      .from('customers')
      .select('id,merchant_id,user_id')
      .eq('id', order.customer_id)
      .eq('merchant_id', order.merchant_id)
      .eq('user_id', user.id)
      .maybeSingle();
    const customer = row(customerResult.data);
    if (
      customerResult.error ||
      customer?.id !== order.customer_id ||
      customer.merchant_id !== order.merchant_id ||
      customer.user_id !== user.id
    )
      return false;
    const merchantResult = await client
      .from('merchants')
      .select('id,slug')
      .eq('id', order.merchant_id)
      .eq('slug', trustedMerchantSlug)
      .maybeSingle();
    const merchant = row(merchantResult.data);
    return (
      !merchantResult.error &&
      merchant?.id === order.merchant_id &&
      merchant.slug === trustedMerchantSlug
    );
  } catch {
    return false;
  }
}
