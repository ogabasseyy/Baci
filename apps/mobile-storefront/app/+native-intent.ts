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
export function derivePlatformRootDomain(
  apiHostname: string,
  explicitRootDomain?: string
): string | undefined {
  if (explicitRootDomain) return explicitRootDomain;
  return PLATFORM_API_ROOTS[apiHostname];
}

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  const apiHostname = new URL(EXPO_PUBLIC_API_URL).hostname;
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
