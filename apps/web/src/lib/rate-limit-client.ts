import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// IP validation (Edge-compatible, no Node.js 'net' module)
// ---------------------------------------------------------------------------

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const IPV6_GROUP_REGEX = /^[0-9a-fA-F]{1,4}$/;

// Complete IPv6 validation (a regex alternation cannot cover every
// compression shape: '2001:db8:85a3::8a2e:370:7334' has groups on both
// sides of '::' and must validate). '::' may appear at most once and
// must compress at least one group; without it exactly 8 groups are
// required. IPv4-mapped forms ('::ffff:1.2.3.4') stay rejected: the
// dotted tail is not a hex group.
function isValidIPv6(ip: string): boolean {
  if (ip.includes(':::')) return false;
  const halves = ip.split('::');
  if (halves.length > 2) return false;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  for (const group of [...head, ...tail]) {
    if (!IPV6_GROUP_REGEX.test(group)) return false;
  }
  const explicit = head.length + tail.length;
  if (halves.length === 1) return explicit === 8;
  return explicit <= 7;
}

function isValidIP(ip: string): boolean {
  return IPV4_REGEX.test(ip) || isValidIPv6(ip);
}

function finalChainIp(value: string | null): string | null {
  // Only the final NON-EMPTY entry is ever returned: every earlier entry
  // is attacker-supplied, so falling back past an invalid final entry
  // would let a caller choose its own bucket with a '<chosen-ip>,
  // garbage' chain. Trailing commas/whitespace are skipped (benign
  // formatting some proxies emit); anything else invalid returns null and
  // the caller falls through to the next signal (fail-closed).
  if (!value) return null;
  const entries = value.split(',');
  for (let i = entries.length - 1; i >= 0; i--) {
    const candidate = entries[i]?.trim();
    if (!candidate) continue;
    return isValidIP(candidate) ? candidate : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Client identifier (IP)
// ---------------------------------------------------------------------------

// NOTE (Cloudflare): behind Cloudflare, Vercel overwrites x-forwarded-for
// with the peer address and does not forward external IPs, so every
// Vercel-set header names the shared egress IP and shoppers behind one
// egress share a bucket. CF-Connecting-IP is deliberately NOT trusted:
// peer-in-egress-ranges proves only Cloudflare's network, not this
// deployment's zone, and Worker subrequests to a non-CF zone carry
// Worker-controlled CF-Connecting-IP — trusting it would let any free
// Worker rotate every per-IP limit globally, strictly worse than egress
// pooling. Zone-verified support is tracked in #3751.
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
  // rotate buckets at will, so these signals are advisory there. Behind
  // Cloudflare the peer is a shared egress IP (see NOTE above), so
  // egress-sharers pool one bucket — accepted, and identical for both
  // identifiers.
  // x-vercel-forwarded-for is read first among the Vercel headers because
  // it survives a proxy stacked on top of Vercel, where x-forwarded-for
  // may be rewritten; on plain Vercel all three carry the same IP. It is
  // gated on VERCEL so a non-Vercel caller cannot mint it as an extra
  // rotation vector.
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
 * Client identity for budgets bound to untrusted callers (anonymous cart
 * proofs, durable intake), where the identifier is the only bound tying
 * a caller to one bucket. Unlike getClientIdentifier this never trusts
 * x-forwarded-for: that header is client-suppliable on any deployment
 * whose edge does not overwrite it, so a caller could rotate it to reset
 * the budget. Only the platform address (NextRequest.ip), the
 * Vercel-gated x-vercel-forwarded-for (same preference as the lenient
 * identifier, so both agree wherever the edge guarantee holds), or an
 * x-real-ip whose overwrite the platform/operator guarantees identifies
 * the client; anything else falls into the single shared 'unknown'
 * bucket, failing closed. (Cloudflare egress pooling: see NOTE above;
 * same accepted residual as the lenient path, tracked in #3751.)
 */
export function getTrustedClientIdentifier(request: NextRequest): string {
  const requestWithIp = request as NextRequest & { ip?: string };
  const requestIp = requestWithIp.ip;
  if (requestIp && isValidIP(requestIp)) {
    return requestIp;
  }

  // x-vercel-forwarded-for first, exactly like getClientIdentifier: it
  // survives a proxy stacked on top of Vercel where other headers may be
  // rewritten, so reading it here keeps the durable budgets measuring the
  // same caller as the proxy layer. Gated on VERCEL like the lenient
  // path: off Vercel the header is client-mintable.
  if (process.env.VERCEL === '1') {
    const vercelForwarded = finalChainIp(
      request.headers.get('x-vercel-forwarded-for')
    );
    if (vercelForwarded) return vercelForwarded;
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
