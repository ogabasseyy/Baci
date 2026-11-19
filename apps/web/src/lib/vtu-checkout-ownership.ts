import type { SupabaseClient } from '@supabase/supabase-js';
import type { authenticateApiRequest } from '@/lib/api-auth';
import { findCheckoutCustomerId } from '@/lib/vtu-checkout-customer-rpcs';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';

/**
 * Merchant + customer owned by the authed user under the slug. Null =
 * genuine not-found/mismatch (400); lookup ERRORS throw (500, key
 * kept). Merchant id backs the replay storefront check (the
 * fingerprint omits merchant binding). Read-only by RPC
 * construction: the find RPC never links (Phase 2, epic #3694), so
 * resolving ownership BEFORE the replay guards cannot write
 * customers.user_id ahead of a mismatched replay's rejection
 * (Codex R86 P1). Extracted from the wallet-only checkout route per
 * the Boy Scout Rule.
 */
export async function resolveRequestingOwnership(
  supabase: SupabaseClient,
  user: NonNullable<Awaited<ReturnType<typeof authenticateApiRequest>>['user']>,
  merchantSlug: string
): Promise<{ customerId: string | null; merchantId: string | null }> {
  // Alias-aware + strict: stale tabs resolve via the alias table; alias
  // failures 500 (key kept) instead of 400 ownership mismatch (rotated).
  const { data: merchant, error: merchantError } =
    await withMerchantSlugAliasFallback(
      merchantSlug,
      (s) =>
        supabase.from('merchants').select('id').eq('slug', s).maybeSingle(),
      { strict: true }
    );
  if (merchantError) {
    throw new Error(
      `Failed to resolve VTU merchant ownership: ${merchantError.message}`
    );
  }
  if (!merchant) {
    return { customerId: null, merchantId: null };
  }
  const customerId = await findCheckoutCustomerId(
    supabase,
    merchant.id as string,
    user.id
  );
  return {
    customerId,
    merchantId: merchant.id as string,
  };
}
