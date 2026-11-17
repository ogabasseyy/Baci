import type { SupabaseClient } from '@supabase/supabase-js';

export type SaveZohoRefreshTokenResult =
  | { ok: true }
  | { ok: false; status: 403 | 500 };

/**
 * Stores the Zoho refresh token through the permission-checked database function.
 * Owners and staff with integrations.manage may write it; everyone else gets 403.
 */
export async function saveZohoRefreshToken(
  supabase: SupabaseClient,
  merchantId: string,
  refreshToken: string | undefined
): Promise<SaveZohoRefreshTokenResult> {
  if (!refreshToken) return { ok: true };
  const { error } = await supabase.rpc('set_merchant_zoho_refresh_token', {
    p_merchant_id: merchantId,
    p_refresh_token: refreshToken,
  });
  if (!error) return { ok: true };
  console.error('Zoho refresh token save failed:', error.code);
  return { ok: false, status: error.code === '42501' ? 403 : 500 };
}
