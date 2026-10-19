import type { SupabaseClient } from '@supabase/supabase-js';
import type { UcpCartSessionRecord } from './ucp-cart-storage';

/** Reads through the caller-provided client; never constructs authority. */
export async function loadUcpCartSession({
  cartId,
  merchantId,
  supabase,
}: {
  cartId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<{ cart: UcpCartSessionRecord | null; error: unknown }> {
  const { data, error } = await supabase
    .from('agentic_cart_sessions')
    .select(
      'id, agent_id, buyer, cart_id, cart_items, checkout_session_id, created_at, currency, expires_at, merchant_id, metadata, migrated_to_cart_id, shipping_address, status, updated_at'
    )
    .eq('cart_id', cartId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (!data || error) {
    return { cart: null, error };
  }
  const row = data as UcpCartSessionRecord &
    Partial<Record<'migrated_to_cart_id', unknown>>;
  return {
    cart: {
      ...(data as UcpCartSessionRecord),
      migratedToCartId:
        typeof row.migrated_to_cart_id === 'string'
          ? row.migrated_to_cart_id
          : null,
    },
    error,
  };
}
