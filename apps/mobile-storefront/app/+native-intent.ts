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

/**
 * Expo Router supplies `initial` for initial and live links. The launcher-root
 * rewrite is intentionally the same in both cases, so this handler only reads
 * `path` while retaining the framework's complete event shape.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  let normalizedPath = path;
  // A custom-scheme launcher root has no route. Query/fragment-only roots
  // still launch Home; a valid pairing link must include the /cart route.
  const launcherRoot = path.split(/[?#]/, 1)[0].toLowerCase();
  if (launcherRoot === 'ogabassey://' || launcherRoot === 'ogabassey:///')
    return '/';

  // Android callers commonly encode the first route as the URL host
  // (`ogabassey://cart`). Expo's native path parser moves that host into the
  // route path, so normalize it here before applying the storefront guards.
  try {
    const customSchemeUrl = new URL(path);
    if (
      customSchemeUrl.protocol.toLowerCase() === 'ogabassey:' &&
      customSchemeUrl.host
    ) {
      const routePath =
        customSchemeUrl.pathname === '/'
          ? ''
          : customSchemeUrl.pathname.replace(/\/$/, '');
      normalizedPath = `/${customSchemeUrl.host}${routePath}${customSchemeUrl.search}${customSchemeUrl.hash}`;
    }
  } catch {
    // Keep the original path; captureCartPairingLink handles malformed input.
  }

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
  return captureCartPairingLink(normalizedPath, {
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    merchantDomain: CONFIG.MERCHANT_DOMAIN,
    platformRootDomain,
  });
}
