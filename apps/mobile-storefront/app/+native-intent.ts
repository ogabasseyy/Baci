import { EXPO_PUBLIC_API_URL, EXPO_PUBLIC_ROOT_DOMAIN } from '@/env';
import { captureCartPairingLink } from '@/lib/cart/pairing-link';
import { CONFIG } from '@/lib/config';

/** Platform API hosts whose root is derivable without configuration. */
const PLATFORM_API_ROOTS: Record<string, string> = {
  'api.usebaci.com': 'usebaci.com',
  'api-staging.usebaci.com': 'usebaci.com',
  'usebaci.com': 'usebaci.com',
};

/**
 * Root domain the web issuer mints continuation URLs under
 * (<slug>.<root>, mirroring NEXT_PUBLIC_ROOT_DOMAIN). Prefer the
 * explicit mobile mirror; otherwise derive only from the known
 * platform API hosts. Any other API host shape (a custom
 * api.<merchant-domain>, staging-api.*, regional hosts, or an
 * arbitrary bare domain) cannot be derived safely and fails closed,
 * so operators must set EXPO_PUBLIC_ROOT_DOMAIN for those deployments.
 */
const BARE_HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Normalize an operator-configured root domain to a bare hostname:
 * trim, lowercase, and strip a trailing dot. Anything else (scheme,
 * port, path, or a malformed name) fails closed to undefined so a
 * misconfigured build disables pairing loudly at this boundary
 * instead of silently stripping every legitimate handoff link.
 */
function normalizeRootDomain(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  return BARE_HOSTNAME.test(normalized) ? normalized : undefined;
}

export function derivePlatformRootDomain(
  apiHostname: string,
  explicitRootDomain?: string
): string | undefined {
  if (explicitRootDomain) return normalizeRootDomain(explicitRootDomain);
  return PLATFORM_API_ROOTS[apiHostname];
}

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  let apiHostname = '';
  try {
    apiHostname = new URL(EXPO_PUBLIC_API_URL).hostname;
  } catch {
    apiHostname = '';
  }
  // Empty string is the fail-closed signal: capture must not
  // substitute the production root for an underivable staging root.
  const platformRootDomain =
    derivePlatformRootDomain(apiHostname, EXPO_PUBLIC_ROOT_DOMAIN) ?? '';
  return captureCartPairingLink(path, {
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    merchantDomain: CONFIG.MERCHANT_DOMAIN,
    platformRootDomain,
  });
}
