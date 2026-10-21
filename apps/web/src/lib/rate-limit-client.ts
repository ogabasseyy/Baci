import type { NextRequest } from 'next/server';
import { isCloudflareEgressIp } from './cloudflare-egress';

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

// The shopper IP behind a verified Cloudflare boundary, or null. Trust
// requires ALL of: Vercel runtime (so the peer headers below are
// edge-set, not caller-supplied), a direct peer inside Cloudflare's
// published egress ranges, and a single valid CF-Connecting-IP value
// (Cloudflare sends one IP; a chain is malformed and ignored). Anything
// else returns null and the caller falls through to the Vercel headers.
// Residual: anyone able to emit traffic from Cloudflare's network with
// an arbitrary CF-Connecting-IP can rotate identifiers; that takes a
// Cloudflare account rather than one raw socket, and merchant/contact
// budgets still bound the harm.
function cloudflareClientIp(
  request: NextRequest,
  platformIp: string | null
): string | null {
  if (process.env.VERCEL !== '1') return null;
  let peer: string | null = null;
  if (platformIp && isValidIP(platformIp)) {
    peer = platformIp;
  } else {
    const realIp = request.headers.get('x-real-ip');
    if (realIp && isValidIP(realIp.trim())) peer = realIp.trim();
  }
  if (!peer || !isCloudflareEgressIp(peer)) return null;
  const connecting = request.headers.get('cf-connecting-ip');
  if (!connecting || connecting.includes(',')) return null;
  const clientIp = connecting.trim();
  return clientIp && isValidIP(clientIp) ? clientIp : null;
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

export function getClientIdentifier(request: NextRequest): string {
  const requestWithIp = request as NextRequest & { ip?: string };
  const requestIp =
    requestWithIp.ip && isValidIP(requestWithIp.ip) ? requestWithIp.ip : null;

  // Behind verified Cloudflare egress the Vercel headers all carry the
  // shared egress IP, so the shopper IP comes from CF-Connecting-IP.
  const cfClientIp = cloudflareClientIp(request, requestIp);
  if (cfClientIp) return cfClientIp;

  // Prefer Next.js/Vercel trusted IP
  if (requestIp) {
    return requestIp;
  }

  // Proxy-header trust: on Vercel the edge overwrites x-forwarded-for with
  // the peer client IP and sets x-real-ip / x-vercel-forwarded-for to the
  // same value, so none of them is client-spoofable in production. Trust
  // holds ONLY behind such an overwriting edge: self-hosted or
  // direct-to-origin traffic can mint a fresh header value per request and
  // rotate buckets at will, so these signals are advisory there. Behind
  // Cloudflare the peer is a shared egress IP, so CF-Connecting-IP (read
  // above, only behind verified Cloudflare egress) names the shopper.
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
 * the budget. Only the platform address (NextRequest.ip), a
 * CF-Connecting-IP behind verified Cloudflare egress, the Vercel-gated
 * x-vercel-forwarded-for (same preference as the lenient identifier, so
 * both agree wherever the edge guarantee holds), or an x-real-ip whose
 * overwrite the platform/operator guarantees identifies the client;
 * anything else falls into the single shared 'unknown' bucket, failing
 * closed.
 */
export function getTrustedClientIdentifier(request: NextRequest): string {
  const requestWithIp = request as NextRequest & { ip?: string };
  const requestIp =
    requestWithIp.ip && isValidIP(requestWithIp.ip) ? requestWithIp.ip : null;

  // Same verified-Cloudflare preference as the lenient identifier, so
  // both agree behind Cloudflare instead of pooling one egress bucket.
  const cfClientIp = cloudflareClientIp(request, requestIp);
  if (cfClientIp) return cfClientIp;

  if (requestIp) {
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
