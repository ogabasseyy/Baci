import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolves the merchant's active primary custom domain for a branded claim
 * link. Custom domains live in public.domains, not on the merchant row;
 * null falls back to the slug subdomain, which always routes.
 *
 * Ownership is established by the domains table, not by the syntactic check
 * in buildReceiptClaimUrl: status only becomes 'active' after DNS/host
 * verification (see the domains verify route), so an 'active' primary row
 * is safe to embed in a token-bearing URL.
 */
export async function resolveManualDocumentClaimDomain(
  supabase: SupabaseClient,
  merchantId: string
): Promise<string | null> {
  const primaryDomain = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', merchantId)
    .eq('is_primary', true)
    .eq('status', 'active')
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(1)
    .maybeSingle();
  return !primaryDomain.error &&
    primaryDomain.data &&
    typeof primaryDomain.data.domain === 'string'
    ? primaryDomain.data.domain
    : null;
}
