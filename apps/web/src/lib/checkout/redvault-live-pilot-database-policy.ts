import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import type { RedvaultLivePilotPolicy } from './redvault-live-pilot';

export async function verifyRedvaultLivePilotDatabasePolicy({
  client,
  policy,
}: {
  client: SupabaseClient;
  policy: RedvaultLivePilotPolicy;
}): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(
      'get_storefront_redvault_live_pilot_policy' as never
    );
    if (error || !Array.isArray(data) || data.length !== 1) return false;
    const row: unknown = data[0];
    if (!row || typeof row !== 'object') return false;
    const binding = row as Record<string, unknown>;
    return (
      binding.enabled === true &&
      binding.audience === policy.audience &&
      binding.merchant_id === policy.merchantId &&
      binding.product_id === policy.productId &&
      (policy.audience === 'public_product_test'
        ? binding.expires_at === null
        : typeof binding.expires_at === 'string' &&
          Date.parse(binding.expires_at) === policy.expiresAt)
    );
  } catch {
    return false;
  }
}
