import { PLATFORM_ROOT_ROUTE_SEGMENTS } from '@/lib/posthog/platform-root-routes';

const PLATFORM_PATH_MODE_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'usebaci.com',
  'www.usebaci.com',
]);

function normalizeHostname(hostname: string | null | undefined) {
  return (
    hostname
      ?.split(':', 1)[0]
      ?.toLowerCase()
      .replace(/^www\./, '') ?? ''
  );
}

function normalizeRootDomain(rootDomain: string | null | undefined) {
  return normalizeHostname(rootDomain || 'usebaci.com');
}

function isPlatformPathModeHost(
  hostname: string | null | undefined,
  rootDomain: string | null | undefined
) {
  const normalized = normalizeHostname(hostname);
  const configuredRootDomain = normalizeRootDomain(rootDomain);
  return (
    PLATFORM_PATH_MODE_HOSTS.has(normalized) ||
    normalized === configuredRootDomain ||
    normalized.endsWith('.vercel.app')
  );
}

/**
 * Matches storefront checkout routes on both custom/subdomain hosts (`/checkout`,
 * `/checkout/...`) and platform path-mode hosts (`/<slug>/checkout`, `/<slug>/checkout/...`).
 */
export function isCheckoutPathname(
  pathname: string | null | undefined,
  {
    hostname = globalThis.location?.hostname,
    rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN,
  }: { hostname?: string | null; rootDomain?: string | null } = {}
): boolean {
  const normalizedPathname = pathname?.split(/[?#]/, 1)[0]?.trim() || '/';
  const segments = normalizedPathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  const firstSegment = segments[0]?.toLowerCase() ?? '';
  if (firstSegment === 'checkout') {
    return true;
  }

  if (PLATFORM_ROOT_ROUTE_SEGMENTS.has(firstSegment)) {
    return false;
  }

  return (
    isPlatformPathModeHost(hostname, rootDomain) &&
    segments.length >= 2 &&
    segments[1]?.toLowerCase() === 'checkout'
  );
}
