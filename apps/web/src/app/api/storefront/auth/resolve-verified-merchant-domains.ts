import type { createClient } from '@/lib/supabase/server';

type StorefrontSupabaseClient = ReturnType<typeof createClient>;

/**
 * Fetches explicitly verified, active custom-domain aliases for a merchant
 * from `public.domains` so OAuth callbacks never auto-trust unverified sibling
 * hostnames such as `www.` unless the merchant proved control of them.
 */
export async function resolveVerifiedMerchantDomains(
  supabase: Partial<StorefrontSupabaseClient>,
  merchantId: string
): Promise<string[]> {
  if (typeof supabase.from !== 'function') {
    return [];
  }

  const { data, error } = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .not('verified_at', 'is', null);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.error('Failed to resolve verified merchant domains:', error);
    }
    return [];
  }

  return data
    .map((row) => row.domain)
    .filter((domain): domain is string => typeof domain === 'string');
}
