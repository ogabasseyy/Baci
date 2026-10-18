/**
 * Cart API transport policy: HTTPS everywhere, except the documented
 * local storefront workflow where a development build talks to a
 * private LAN/localhost API (e.g. http://192.168.100.70:4193). The
 * local exception requires a dev build and a loopback/private host,
 * mirroring the repair pickup client's secure-origin rule.
 */
/**
 * Cart-scoped API origin: the cart bootstrap proof is only disclosed
 * on recognized programmatic api.* surfaces (and dev loopback/LAN),
 * never on browsable storefront hosts. Map platform apex and custom
 * white-label origins paired with an explicit platform root domain to
 * their programmatic api.* counterpart, and fail closed to an empty
 * string when a custom host has no trusted programmatic target.
 */
const BARE_HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeRootDomain(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  return BARE_HOSTNAME.test(normalized) ? normalized : undefined;
}

function isLocalDevHost(host: string): boolean {
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

export function resolveCartApiOrigin(
  configuredOrigin: string,
  explicitRootDomain?: string
): string {
  try {
    const url = new URL(configuredOrigin);
    if (
      !isAllowedCartApiProtocol(url) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return '';
    }
    const host = url.hostname.toLowerCase();
    if (
      host === 'staging.ogabassey.com' ||
      host === 'api-staging.ogabassey.com'
    ) {
      url.hostname = 'api-staging.ogabassey.com';
      return url.toString().replace(/\/$/, '');
    }
    if (explicitRootDomain !== undefined) {
      const root = normalizeRootDomain(explicitRootDomain);
      if (!root) return '';
      if (host === `api.${root}` || host === `api-staging.${root}`) {
        return url.toString().replace(/\/$/, '');
      }
      url.hostname = `api.${root}`;
      return url.toString().replace(/\/$/, '');
    }
    if (host === 'usebaci.com' || host === 'api.usebaci.com') {
      url.hostname = 'api.usebaci.com';
      return url.toString().replace(/\/$/, '');
    }
    if (host === 'api-staging.usebaci.com') {
      return url.toString().replace(/\/$/, '');
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__ && isLocalDevHost(host)) {
      return url.toString().replace(/\/$/, '');
    }
    return '';
  } catch {
    return '';
  }
}

export function isAllowedCartApiProtocol(base: URL): boolean {
  if (base.protocol === 'https:') return true;
  if (base.protocol !== 'http:') return false;
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  return isLocalDevHost(base.hostname.toLowerCase());
}
