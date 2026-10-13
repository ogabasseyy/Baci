/**
 * Merchant resolution for VTU prepare flows.
 *
 * Extracted from vtu-pending-transaction.ts per the 300-line Boy
 * Scout Rule (that module is already far beyond budget): the
 * alias-aware lookup and its strict failure behavior live here so
 * the prepare flow stays a thin orchestration.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { throwIfStrictVtuLookupError } from '@/lib/vtu-strict-lookups';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';

export interface VtuMerchantRow {
  id: string;
  slug: string;
  business_name: string | null;
  paystack_subaccount_code: string | null;
}

interface ResolveVtuMerchantInput {
  supabase: SupabaseClient;
  merchantSlug: string;
  strictLookups?: boolean;
}

/**
 * Resolves the merchant row for a VTU prepare. Alias-aware (stale
 * tabs on renamed stores resolve via the alias table, live slug
 * wins). Strict callers get a throw on alias-DB failure (500, key
 * kept); non-strict callers keep legacy lenient behavior (not-found).
 * Throws 'Merchant not found' when no merchant matches.
 */
export async function resolveVtuMerchant({
  merchantSlug,
  strictLookups = false,
  supabase,
}: ResolveVtuMerchantInput): Promise<VtuMerchantRow> {
  const { data: merchant, error: merchantError } =
    await withMerchantSlugAliasFallback(
      merchantSlug,
      (s) =>
        supabase
          .from('merchants')
          .select('id, slug, business_name, paystack_subaccount_code')
          .eq('slug', s)
          .maybeSingle(),
      { strict: strictLookups }
    );

  // Strict: a transient lookup error must 500 (key kept), never
  // masquerade as a terminal 400/404 (key rotated).
  throwIfStrictVtuLookupError({
    context: 'resolve VTU merchant',
    error: merchantError,
    strictLookups,
  });
  if (merchantError || !merchant) {
    throw new Error('Merchant not found');
  }
  return merchant as VtuMerchantRow;
}
