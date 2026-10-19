import type { SupabaseClient } from '@supabase/supabase-js';
import type { authenticateApiRequest } from '@/lib/api-auth';
import { resolveVtuCustomer } from '@/lib/vtu-customer-resolution';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';

/**
 * Merchant + customer owned by the authed user under the slug. Null =
 * genuine not-found/mismatch (400); lookup ERRORS throw (500, key
 * kept). Merchant id backs the replay storefront check (the
 * fingerprint omits merchant binding). Read-only: customer resolution
 * runs BEFORE the replay guards, so it must not link (a mismatched
 * replay would otherwise write customers.user_id before rejection);
 * email-linking is reserved for the fresh path inside prepare (Codex
 * R86 P1). Extracted from the wallet-only checkout route per the Boy
 * Scout Rule.
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
  const customer = await resolveVtuCustomer({
    supabase,
    merchantId: merchant.id as string,
    linkEmailMatch: false,
    strictLookups: true,
    user,
  });
  return {
    customerId: customer?.id ?? null,
    merchantId: merchant.id as string,
  };
}
