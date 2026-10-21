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

function finalChainIp(value: string | null): string | null {
  // Only the FINAL entry is ever returned: every earlier entry is
  // attacker-supplied, so falling back to one when the final entry is
  // invalid would let a caller choose its own bucket with a
  // '<chosen-ip>, garbage' chain. An invalid final entry returns null
  // and the caller falls through to the next signal (fail-closed).
  if (!value) return null;
  const entries = value.split(',');
  const final = entries[entries.length - 1]?.trim();
  if (final && isValidIP(final)) return final;
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
  // rotate buckets at will, so these signals are advisory there.
  // x-vercel-forwarded-for is read first because it survives a proxy
  // stacked on top of Vercel, where x-forwarded-for may be rewritten; on
  // plain Vercel all three carry the same IP. It is gated on VERCEL so a
  // non-Vercel caller cannot mint it as an extra rotation vector.
  // Multi-entry chains resolve to the FINAL entry only, never an earlier
  // one: every earlier entry is client-supplied, so scanning back past an
  // invalid final entry would let an attacker choose its own bucket, while
  // an invalid final entry falls through to the next signal (fail-closed).
  // Callers without any usable signal share the single 'unknown' bucket,
  // which exhausts fast by design.
  if (process.env.VERCEL === '1') {
    const vercelForwarded = finalChainIp(
      request.headers.get('x-vercel-forwarded-for')
    );
    if (vercelForwarded) return vercelForwarded;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIP(realIp.trim())) return realIp.trim();

  const forwarded = finalChainIp(request.headers.get('x-forwarded-for'));
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
