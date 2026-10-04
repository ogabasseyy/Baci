import { createPublicClient } from './supabase/public';

export type PublicDomainResolution =
  | { outcome: 'resolved'; value: string }
  | { outcome: 'not-found' }
  | { outcome: 'unavailable' };

type PublicDomainResolverName =
  | 'resolve_storefront_custom_domain'
  | 'resolve_storefront_domain_slug';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function resolvePublicDomain(
  rpcName: PublicDomainResolverName,
  args: Record<string, string>
): Promise<PublicDomainResolution> {
  try {
    const { data, error } = await createPublicClient({
      clientInfo: 'baci-domain-cache-resolver',
    }).rpc(rpcName, args);

    if (error) {
      console.error('[Domain Cache] Public domain resolver failed', {
        rpcName,
        code: error.code,
      });
      return { outcome: 'unavailable' };
    }
    if (data === null) return { outcome: 'not-found' };
    if (isNonEmptyString(data)) return { outcome: 'resolved', value: data };

    console.error(
      '[Domain Cache] Public domain resolver returned malformed data',
      {
        rpcName,
      }
    );
    return { outcome: 'unavailable' };
  } catch {
    console.error('[Domain Cache] Public domain resolver was unavailable', {
      rpcName,
    });
    return { outcome: 'unavailable' };
  }
}

export function fetchSlugForDomain(
  domain: string
): Promise<PublicDomainResolution> {
  return resolvePublicDomain('resolve_storefront_domain_slug', {
    p_domain: domain,
  });
}

export function fetchCustomDomain(
  merchantSlug: string
): Promise<PublicDomainResolution> {
  return resolvePublicDomain('resolve_storefront_custom_domain', {
    p_slug: merchantSlug,
  });
}
