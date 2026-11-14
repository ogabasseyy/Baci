import type { headers } from 'next/headers';

const getRootDomain = () =>
  process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || 'usebaci.com';

export function resolveMerchantContextIdentifier(
  headersList: Awaited<ReturnType<typeof headers>>
) {
  const customDomain = headersList.get('x-custom-domain')?.toLowerCase();
  if (customDomain) {
    return customDomain;
  }

  const merchantDomain = headersList.get('x-merchant-domain')?.toLowerCase();
  if (merchantDomain) {
    return merchantDomain;
  }

  const merchantSlug = headersList.get('x-merchant-slug')?.toLowerCase();
  if (merchantSlug) {
    return merchantSlug;
  }

  return '';
}

export function resolveRouteIdentifier(
  headersList: Awaited<ReturnType<typeof headers>>
) {
  const merchantContextIdentifier =
    resolveMerchantContextIdentifier(headersList);
  if (merchantContextIdentifier) {
    return merchantContextIdentifier;
  }

  const host = headersList.get('host')?.split(':')[0].toLowerCase();
  if (!host) {
    return '';
  }

  const normalizedHost = host.replace(/^www\./, '');
  const rootDomain = (getRootDomain() || 'usebaci.com').toLowerCase();
  const developmentHosts = new Set(['127.0.0.1', 'localhost']);

  if (developmentHosts.has(normalizedHost)) {
    return '';
  }

  if (normalizedHost === rootDomain) {
    return '';
  }

  if (normalizedHost.endsWith(`.${rootDomain}`)) {
    return normalizedHost.slice(0, -(rootDomain.length + 1));
  }

  return normalizedHost;
}
