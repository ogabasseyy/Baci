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

function lastValidChainIp(value: string | null): string | null {
  if (!value) return null;
  const ips = value.split(',').map((ip) => ip.trim());
  for (let i = ips.length - 1; i >= 0; i--) {
    const candidate = ips[i];
    if (candidate && isValidIP(candidate)) {
      return candidate;
    }
  }
  return null;
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

  // Proxy-header trust: on Vercel the edge overwrites x-forwarded-for with
  // the peer client IP and sets x-real-ip / x-vercel-forwarded-for to the
  // same value, so none of them is client-spoofable in production. Trust
  // holds ONLY behind such an overwriting edge: self-hosted or
  // direct-to-origin traffic can mint a fresh header value per request and
  // rotate buckets at will. x-vercel-forwarded-for is read first because
  // it survives a proxy stacked on top of Vercel, where x-forwarded-for
  // may be rewritten; on plain Vercel all three carry the same IP.
  // Multi-entry chains resolve to the LAST valid hop, never the first:
  // the leftmost entry is client-supplied, so .at(0) would let an attacker
  // mint a fresh identity per request and bypass the limiter entirely,
  // while last-hop worst case shares one bucket behind a proxy
  // (fail-closed). Callers without any usable signal share the single
  // 'unknown' bucket, which exhausts fast by design.
  const vercelForwarded = lastValidChainIp(
    request.headers.get('x-vercel-forwarded-for')
  );
  if (vercelForwarded) return vercelForwarded;

  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIP(realIp.trim())) return realIp.trim();

  const forwarded = lastValidChainIp(request.headers.get('x-forwarded-for'));
  if (forwarded) return forwarded;

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
    const realIp = request.headers.get('x-real-ip');
    if (realIp && isValidIP(realIp)) return realIp;
  }

  return 'unknown';
}
