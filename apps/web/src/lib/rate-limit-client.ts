import type { NextRequest } from 'next/server';

import {
  isValidIP,
  normalizedClientIp,
  platformPeerIp,
  verifiedCloudflareVisitorIp,
  visitorQuotaIdentity,
} from './cloudflare-peer';

/**
 * Whether the deployment guarantees the edge overwrites proxy headers:
 * on Vercel, or where the operator explicitly asserts a trusted proxy
 * (CART_TRUST_PROXY_HEADERS=true).
 */
function proxyHeadersGuaranteed(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.CART_TRUST_PROXY_HEADERS?.trim() === 'true'
  );
}

export function getClientIdentifier(request: NextRequest): string {
  // Prefer Next.js/Vercel trusted IP
  const requestWithIp = request as NextRequest & { ip?: string };
  const requestIp = requestWithIp.ip;
  const realIp = request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');

  // Behind Cloudflare the platform address is a shared egress, not the
  // visitor: prefer the authenticated visitor address so per-IP rate
  // limiting also buckets per customer instead of per egress. The peer
  // evidence must itself be trustworthy: the platform address, or an
  // x-real-ip only under the same proxy guarantee the trusted
  // identifier requires. The result is always a real IP address (or
  // 'unknown'): consumers persist and forward it as one.
  const peerIp = platformPeerIp(request, proxyHeadersGuaranteed());
  const visitorIp = verifiedCloudflareVisitorIp(request, peerIp);
  if (visitorIp) return visitorIp;

  if (requestIp && isValidIP(requestIp)) {
    return requestIp;
  }

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

  // x-real-ip is only trustworthy when the platform guarantees the
  // edge overwrites it: on Vercel, or where the operator explicitly
  // asserts a trusted proxy (CART_TRUST_PROXY_HEADERS=true). On any
  // other deployment the header is client-suppliable, so it collapses
  // into the shared 'unknown' bucket instead of resetting budgets.
  const proxyGuaranteed = proxyHeadersGuaranteed();
  if (proxyGuaranteed) {
    const realIp = request.headers.get('x-real-ip');
    // Behind Cloudflare, the platform address is a shared Cloudflare
    // egress, so keying anonymous budgets on it collapses many
    // customers into one bootstrap bucket and mass-produces "cart sync
    // was interrupted" failures. Prefer the authenticated visitor
    // address when the immediate peer proves Cloudflare traversal.
    const peerIp = platformPeerIp(request, true);
    const visitorIp = verifiedCloudflareVisitorIp(request, peerIp);
    // /64 bucketing is scoped to the verified-visitor path: it exists
    // because a verified IPv6 visitor controls their interface
    // identifier. Fallback platform addresses keep their exact
    // (normalized) form so unrelated subscribers sharing a /64 —
    // carrier NAT64, corporate egress — never share anonymous budgets.
    if (visitorIp) return visitorQuotaIdentity(visitorIp);
    // Fall back in platformPeerIp's trust order: the platform address
    // outranks any header, even a guaranteed one.
    if (requestIp && isValidIP(requestIp)) {
      return normalizedClientIp(requestIp);
    }
    if (realIp && isValidIP(realIp)) return normalizedClientIp(realIp);
  }

  if (requestIp && isValidIP(requestIp)) {
    return normalizedClientIp(requestIp);
  }
  return 'unknown';
}
