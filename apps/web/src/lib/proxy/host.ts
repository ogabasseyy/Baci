import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';

export const ROOT_DOMAIN = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
)
  .trim()
  .replace(/[\r\n]/g, '');

export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'assets',
  'static',
  'cdn',
  'status',
  'support',
  'help',
]);

export const VALID_SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isPlatformHost(hostname: string): boolean {
  return (
    isRootDomain(hostname, ROOT_DOMAIN) ||
    isVercelPreview(hostname) ||
    (isLocalhost(hostname) && extractLocalhostSubdomain(hostname) === null)
  );
}

export function normalizeHostname(hostname: string): string {
  return hostname.split(':')[0].toLowerCase();
}

export async function getSlugForOriginCustomDomain(
  hostname: string
): Promise<string | null> {
  const normalizedHostname = normalizeHostname(hostname);

  if (normalizedHostname.startsWith('www.')) {
    const apexHostname = normalizedHostname.slice('www.'.length);
    const apexSlug = await getSlugForCustomDomain(apexHostname);
    if (apexSlug) {
      return apexSlug;
    }
  }

  return getSlugForCustomDomain(normalizedHostname);
}

export function isValidSubdomain(subdomain: string): boolean {
  return VALID_SUBDOMAIN_REGEX.test(subdomain);
}

export function extractSubdomain(
  hostname: string,
  parentDomain: string
): string | null {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedParent = parentDomain.toLowerCase();
  const expectedSuffix = `.${normalizedParent}`;

  // Must end with .parentdomain exactly
  if (!normalizedHost.endsWith(expectedSuffix)) {
    return null;
  }

  // Extract subdomain part
  const subdomain = normalizedHost.slice(0, -expectedSuffix.length);

  // Validate: not empty, no dots (no nested subdomains), valid DNS characters
  if (!subdomain || subdomain.includes('.') || !isValidSubdomain(subdomain)) {
    return null;
  }

  return subdomain;
}

export function isRootDomain(hostname: string, rootDomain: string): boolean {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedRoot = rootDomain.toLowerCase();

  return (
    normalizedHost === normalizedRoot ||
    normalizedHost === `www.${normalizedRoot}` ||
    // Explicitly allow usebaci.com (platform domain) to handle legacy access
    normalizedHost === 'usebaci.com' ||
    normalizedHost === 'www.usebaci.com'
  );
}

export function isVercelPreview(hostname: string): boolean {
  const normalizedHost = normalizeHostname(hostname);

  // Must end with exactly .vercel.app
  if (!normalizedHost.endsWith('.vercel.app')) {
    return false;
  }

  // Extract the subdomain part before .vercel.app
  const vercelSubdomain = normalizedHost.slice(0, -'.vercel.app'.length);

  // Vercel subdomains are alphanumeric with hyphens, typically contain project identifiers
  // Reject if empty or contains dots (nested subdomains)
  if (!vercelSubdomain || vercelSubdomain.includes('.')) {
    return false;
  }

  return isValidSubdomain(vercelSubdomain);
}

export function isLocalhost(hostname: string): boolean {
  const normalizedHost = normalizeHostname(hostname);

  // Standard localhost/loopback
  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.localhost')
  ) {
    return true;
  }

  // Allow private/local IP ranges ONLY in development (for physical devices testing over WiFi)
  if (process.env.NODE_ENV === 'development') {
    // 192.168.x.x
    if (normalizedHost.startsWith('192.168.')) return true;
    // 10.x.x.x
    if (normalizedHost.startsWith('10.')) return true;
    // 172.16.x.x to 172.31.x.x
    const match172 = normalizedHost.match(/^172\.(1[6-9]|2[0-9]|3[01])\./);
    if (match172) return true;
  }

  return false;
}

export function extractLocalhostSubdomain(hostname: string): string | null {
  const normalizedHost = normalizeHostname(hostname);

  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') {
    return null; // Plain localhost - no subdomain
  }

  if (normalizedHost.endsWith('.localhost')) {
    const subdomain = normalizedHost.slice(0, -'.localhost'.length);
    if (subdomain && !subdomain.includes('.') && isValidSubdomain(subdomain)) {
      return subdomain;
    }
  }

  return null;
}

export function isValidCustomDomain(hostname: string): boolean {
  const normalizedHost = normalizeHostname(hostname);

  // Must have at least one dot (domain.tld)
  if (!normalizedHost.includes('.')) return false;

  // No IP addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalizedHost)) return false;

  // Basic domain validation: alphanumeric, hyphens, dots
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(normalizedHost)) return false;

  // No consecutive dots
  if (normalizedHost.includes('..')) return false;

  return true;
}
