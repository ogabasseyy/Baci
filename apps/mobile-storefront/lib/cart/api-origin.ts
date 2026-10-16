/**
 * Cart API transport policy: HTTPS everywhere, except the documented
 * local storefront workflow where a development build talks to a
 * private LAN/localhost API (e.g. http://192.168.100.70:4193). The
 * local exception requires a dev build and a loopback/private host,
 * mirroring the repair pickup client's secure-origin rule.
 */
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
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}
