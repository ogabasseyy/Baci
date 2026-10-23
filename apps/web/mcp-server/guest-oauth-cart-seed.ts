import type { SupabaseClient } from '@supabase/supabase-js';
import { GuestOAuthStorageError } from './guest-oauth-records';

/** Bind an empty legacy handle to the trusted tenant before canonical migration. */
export async function seedOAuthGuestCart(
  client: SupabaseClient,
  merchantId: string,
  token: string,
  expiresAt: string,
): Promise<void> {
  const { data, error } = await client.rpc('mcp_guest_oauth_seed_cart', {
    p_merchant_id: merchantId,
    p_token: token,
    p_expires_at: expiresAt,
  });
  if (error || data !== true) throw new GuestOAuthStorageError();
}
