import type { NextRequest } from 'next/server';
import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';
import { isValidCustomDomain, normalizeHostname } from '@/lib/proxy/host';
import { annotateMerchantTrace } from '@/lib/proxy/merchant-tracing';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

export interface CustomDomainContext {
  domain: string;
  domainPathSegments: string[];
  domainMerchantSlug: string | null;
  normalizedRequestHost: string;
  requestHostHadWww: boolean;
}

export async function resolveCustomDomainContext(
  request: NextRequest,
  hostname: string
): Promise<CustomDomainContext | null> {
  if (!isValidCustomDomain(hostname)) {
    return null;
  }

  const normalizedRequestHost = normalizeHostname(hostname);
  const domain = normalizedRequestHost.replace(/^www\./, '');
  let domainMerchantSlug = await getSlugForCustomDomain(domain);

  // The reverse-domain cache can briefly return a retired slug after a rename.
  // Follow the authoritative alias to retain a routable storefront destination.
  if (domainMerchantSlug) {
    const currentForDomainSlug =
      await getCurrentSlugForAlias(domainMerchantSlug);
    if (currentForDomainSlug && currentForDomainSlug !== domainMerchantSlug) {
      domainMerchantSlug = currentForDomainSlug;
    }
  }
  if (domainMerchantSlug) {
    annotateMerchantTrace(domainMerchantSlug, domain);
  }

  return {
    domain,
    domainPathSegments: request.nextUrl.pathname.split('/').filter(Boolean),
    domainMerchantSlug,
    normalizedRequestHost,
    requestHostHadWww: normalizedRequestHost.startsWith('www.'),
  };
}
