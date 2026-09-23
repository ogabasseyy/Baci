import type { SupabaseClient } from '@supabase/supabase-js';

interface MerchantDomainRow {
  domain: string;
  is_primary: boolean | null;
  status: string;
  domain_type: string;
}

function isMerchantDomainRow(value: unknown): value is MerchantDomainRow {
  if (!value || typeof value !== 'object') return false;
  const domain = Reflect.get(value, 'domain');
  const isPrimary = Reflect.get(value, 'is_primary');
  const status = Reflect.get(value, 'status');
  const domainType = Reflect.get(value, 'domain_type');
  return (
    typeof domain === 'string' &&
    (typeof isPrimary === 'boolean' || isPrimary === null) &&
    typeof status === 'string' &&
    typeof domainType === 'string'
  );
}

export async function fetchSlugForDomain(
  supabase: SupabaseClient,
  domain: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('domains')
      .select('merchants!inner(slug)')
      .eq('domain', domain)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Domain Cache] Failed to fetch slug for domain', {
        domain,
        error,
      });
      return null;
    }
    if (!data) return null;

    if (!data.merchants || typeof data.merchants !== 'object') return null;
    const merchant = Array.isArray(data.merchants)
      ? data.merchants[0]
      : data.merchants;
    if (!merchant || typeof merchant !== 'object') return null;
    const slug = Reflect.get(merchant, 'slug');
    return typeof slug === 'string' ? slug : null;
  } catch (error) {
    console.error('[Domain Cache] Error fetching slug for domain', {
      domain,
      error,
    });
    return null;
  }
}

export async function fetchCustomDomain(
  supabase: SupabaseClient,
  merchantSlug: string
): Promise<string | null> {
  try {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, domains!left(domain, is_primary, status, domain_type)')
      .eq('slug', merchantSlug)
      .maybeSingle();

    if (error) {
      console.error('[Domain Cache] Failed to fetch merchant domain data', {
        merchantSlug,
        error,
      });
      return null;
    }
    if (!merchant) return null;

    const rawDomains = Reflect.get(merchant, 'domains');
    const domains = Array.isArray(rawDomains)
      ? rawDomains.filter(isMerchantDomainRow)
      : [];
    const activeCustomDomains =
      domains?.filter(
        (domain) =>
          domain.status === 'active' &&
          (domain.domain_type === 'custom' ||
            domain.domain_type === 'purchased') &&
          typeof domain.domain === 'string'
      ) ?? [];
    const primaryDomain = activeCustomDomains.find(
      (domain) => domain.is_primary
    );

    if (primaryDomain) return primaryDomain.domain;
    return activeCustomDomains.length === 1
      ? activeCustomDomains[0].domain
      : null;
  } catch {
    return null;
  }
}
