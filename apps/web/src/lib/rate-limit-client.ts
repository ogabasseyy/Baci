import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// IP validation (Edge-compatible, no Node.js 'net' module)
// ---------------------------------------------------------------------------

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const IPV6_REGEX =
  /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^::$/;

function isValidIP(ip: string): boolean {
  return IPV4_REGEX.test(ip) || IPV6_REGEX.test(ip);
}

// ---------------------------------------------------------------------------
// Client identifier (IP)
// ---------------------------------------------------------------------------

export function getClientIdentifier(request: NextRequest): string {
  // Prefer Next.js/Vercel trusted IP
  const requestWithIp = request as NextRequest & { ip?: string };
  const requestIp = requestWithIp.ip;
  if (requestIp && isValidIP(requestIp)) {
    return requestIp;
  }

  const realIp = request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');

  if (realIp && isValidIP(realIp)) return realIp;

  if (forwarded) {
    const ips = forwarded.split(',').map((ip) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      const candidate = ips[i];
      if (candidate && isValidIP(candidate)) {
        return candidate;
      }
    }
  }

  return 'unknown';
}

/**
 * Client identity for the unauthenticated cart budgets, which are the
 * only bound tying anonymous proofs to one client. Unlike
 * getClientIdentifier this never trusts x-forwarded-for: that header is
 * client-suppliable on any deployment whose edge does not overwrite it,
 * so a caller could rotate it to reset the budget. Only the platform
 * address (NextRequest.ip, or an x-real-ip whose overwrite the
 * platform/operator guarantees) identifies the client; anything else
 * falls into the single shared 'unknown' bucket, failing closed.
 */
export function getTrustedClientIdentifier(request: NextRequest): string {
  const requestWithIp = request as NextRequest & { ip?: string };
  const requestIp = requestWithIp.ip;
  if (requestIp && isValidIP(requestIp)) {
    return requestIp;
  }

  // x-real-ip is only trustworthy when the platform guarantees the
  // edge overwrites it: on Vercel, or where the operator explicitly
  // asserts a trusted proxy (CART_TRUST_PROXY_HEADERS=true). On any
  // other deployment the header is client-suppliable, so it collapses
  // into the shared 'unknown' bucket instead of resetting budgets.
  const proxyGuaranteed =
    process.env.VERCEL === '1' ||
    process.env.CART_TRUST_PROXY_HEADERS?.trim() === 'true';
  if (proxyGuaranteed) {
    // Behind Cloudflare, the platform x-real-ip is a shared Cloudflare
    // egress address, so keying anonymous budgets on it collapses many
    // customers into one 30/hour bootstrap bucket and mass-produces
    // "cart sync was interrupted" failures. Cloudflare overwrites
    // CF-Connecting-IP with the visitor address at its edge; require a
    // CF-Ray header as evidence the request actually traversed
    // Cloudflare before trusting it, and keep the platform address as
    // the fallback. Origin access should still be restricted to
    // Cloudflare (Authenticated Origin Pulls) so direct-to-origin
    // callers cannot forge these headers to rotate budgets.
    const cloudflareIp = request.headers.get('cf-connecting-ip');
    if (
      request.headers.get('cf-ray') &&
      cloudflareIp &&
      isValidIP(cloudflareIp)
    ) {
      return cloudflareIp;
    }
    const realIp = request.headers.get('x-real-ip');
    if (realIp && isValidIP(realIp)) return realIp;
  }

  return 'unknown';
}
