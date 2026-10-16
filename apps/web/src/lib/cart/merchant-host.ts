/**
 * Host classification for cart merchant resolution: normalization,
 * loopback/LAN detection, and the shared-platform host set. The host
 * (never client input) is the first tenant signal, so these parsers
 * are kept exact and anchored.
 */
export function normalizeHost(value: string | null): string {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw.startsWith('[')) {
    // Bracketed IPv6 literal, optionally with a port: [::1]:3000.
    const closing = raw.indexOf(']');
    return closing >= 0 ? raw.slice(0, closing + 1) : raw;
  }
  return raw.split(':')[0] ?? '';
}

export function requestHost(request: Request): string {
  const header = normalizeHost(request.headers.get('host'));
  if (header) return header;
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeHeader(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Private-LAN development hosts, mirroring the native client's
 * dev-only API origin policy: the mobile app may call a LAN address
 * with an explicit merchantSlug hint, so the hint must govern there
 * too instead of the IP being treated as a merchant identifier.
 * Anchored IPv4 patterns reject look-alike hostnames. Bracketed and
 * bare IPv6 loopback are development hosts on both sides.
 */
export function isPrivateLanHost(host: string): boolean {
  // Octets are range-anchored (25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])
  // so look-alikes such as 10.999.999.999 never classify as LAN hosts.
  return (
    host === '::1' ||
    host === '[::1]' ||
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

export function isSharedPlatformHost(
  host: string,
  rootDomain: string
): boolean {
  return (
    host === rootDomain ||
    host === `www.${rootDomain}` ||
    // The native clients call the api.* origin with an explicit
    // merchantSlug hint; 'api' is a platform host, never a merchant.
    host === `api.${rootDomain}` ||
    host === `api-staging.${rootDomain}` ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    isPrivateLanHost(host)
  );
}
