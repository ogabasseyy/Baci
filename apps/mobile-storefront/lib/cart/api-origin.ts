/**
 * Cart API transport policy: HTTPS everywhere, except the documented
 * local storefront workflow where a development build talks to a
 * private LAN/localhost API (e.g. http://192.168.100.70:4193). The
 * local exception requires a dev build and a loopback/private host,
 * mirroring the repair pickup client's secure-origin rule.
 */
/**
 * Cart-scoped API origin: the cart bootstrap proof is only disclosed
 * on the programmatic api.* surface, so when the app-wide configured
 * origin is the platform apex, cart calls go to its api.* counterpart.
 * Already-programmatic and custom operator hosts pass through
 * unchanged (custom deployments serve cart from their configured API
 * host and own that deployment contract).
 */
const PLATFORM_APEX_TO_CART_HOST: Record<string, string> = {
  'usebaci.com': 'api.usebaci.com',
  // The hosted-staging pin is the browsable staging host; its
  // programmatic counterpart is where body proofs are disclosed.
  'staging.ogabassey.com': 'api-staging.ogabassey.com',
};

export function resolveCartApiOrigin(configuredOrigin: string): string {
  try {
    const url = new URL(configuredOrigin);
    const cartHost = PLATFORM_APEX_TO_CART_HOST[url.hostname.toLowerCase()];
    if (!cartHost) return configuredOrigin;
    url.hostname = cartHost;
    return url.toString().replace(/\/$/, '');
  } catch {
    return configuredOrigin;
  }
}

export function isAllowedCartApiProtocol(base: URL): boolean {
  if (base.protocol === 'https:') return true;
  if (base.protocol !== 'http:') return false;
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  const host = base.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    // WHATWG URL keeps brackets on IPv6 literals in some runtimes.
    host === '::1' ||
    host === '[::1]' ||
    // Octets are range-anchored so invalid look-alikes never qualify.
    /^10\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/.test(
      host
    ) ||
    /^192\.168\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/.test(
      host
    ) ||
    /^172\.(?:1[6-9]|2[0-9]|3[01])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/.test(
      host
    )
  );
}
