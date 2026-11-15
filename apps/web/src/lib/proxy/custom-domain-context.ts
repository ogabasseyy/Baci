import type { NextRequest } from 'next/server';
import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';
import { getCustomDomainAliasPrefix } from '@/lib/proxy/custom-domain-alias-routing';
import { isValidCustomDomain, normalizeHostname } from '@/lib/proxy/host';
import { annotateMerchantTrace } from '@/lib/proxy/merchant-tracing';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';

export interface CustomDomainContext {
  domain: string;
  domainPathSegments: string[];
  domainMerchantSlug: string | null;
  pathAliasCurrentSlug: string | null;
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
  const domainPathSegments = request.nextUrl.pathname
    .split('/')
    .filter(Boolean);
  const domainSlug = await getSlugForCustomDomain(domain);
  let domainMerchantSlug = domainSlug;
  let pathAliasCurrentSlug: string | null = null;

  if (domainSlug) {
    // The reverse-domain cache can still contain a retired slug after a rename.
    const domainAlias = getCurrentSlugForAlias(domainSlug);
    const prefix = getCustomDomainAliasPrefix(
      request.method,
      domainPathSegments
    );
    let prefixAlias: Promise<string | null> | null = null;
    if (prefix) {
      prefixAlias =
        prefix === domainSlug.toLowerCase()
          ? domainAlias
          : getCurrentSlugForAlias(prefix);
    }
    const [currentSlug, currentPrefixSlug] = await Promise.all([
      domainAlias,
      prefixAlias,
    ]);
    domainMerchantSlug = currentSlug ?? domainSlug;
    pathAliasCurrentSlug = currentPrefixSlug;
  }
  if (domainMerchantSlug) {
    annotateMerchantTrace(domainMerchantSlug, domain);
  }

  return {
    domain,
    domainPathSegments,
    pathAliasCurrentSlug,
    domainMerchantSlug,
    normalizedRequestHost,
    requestHostHadWww: normalizedRequestHost.startsWith('www.'),
  };
}
