import type { NextRequest } from 'next/server';

// IP parsing and Cloudflare peer verification for the rate-limit client
// identifiers. Edge-compatible: no Node.js 'net' module.

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

export function isValidIP(ip: string): boolean {
  return IPV4_REGEX.test(ip) || ipv6ToBigInt(ip) !== null;
}

// Published Cloudflare egress ranges (https://www.cloudflare.com/ips-v4
// and /ips-v6, fetched 2026-10-26). They authenticate the immediate
// peer: CF-Connecting-IP is only meaningful when the platform-verified
// connecting address is itself a Cloudflare egress, because Cloudflare
// overwrites that header at its edge. A direct-to-origin caller's peer
// address is their own, so forged CF headers from them are ignored.
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;
const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

function ipv4ToBigInt(ip: string): bigint | null {
  if (!IPV4_REGEX.test(ip)) return null;
  return ip
    .split('.')
    .reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Structural parser: split on the single allowed "::", validate
  // every group (IPv4-embedded tails become two hex groups first),
  // and expand to eight 16-bit groups.
  let value = ip;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon < 0) return null;
    const v4 = ipv4ToBigInt(value.slice(lastColon + 1));
    if (v4 === null) return null;
    value =
      value.slice(0, lastColon + 1) +
      `${Number((v4 >> 16n) & 0xffffn).toString(16)}:${Number(v4 & 0xffffn).toString(16)}`;
  }
  const parts = value.split('::');
  if (parts.length > 2) return null;
  const [head, rest] = parts;
  const headGroups = head ? head.split(':') : [];
  const tailGroups = rest ? rest.split(':') : [];
  const groupPattern = /^[0-9a-fA-F]{1,4}$/;
  if (![...headGroups, ...tailGroups].every((g) => groupPattern.test(g))) {
    return null;
  }
  if (rest === undefined) {
    if (headGroups.length !== 8) return null;
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  if (rest !== undefined && missing < 1) return null;
  if (missing < 0) return null;
  const groups = [
    ...headGroups,
    ...Array.from({ length: missing }, () => '0'),
    ...tailGroups,
  ];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return result;
}

function ipInCidr(
  address: bigint,
  cidr: string,
  parse: (ip: string) => bigint | null,
  bits: bigint
): boolean {
  const [base, prefixText] = cidr.split('/');
  const baseValue = base ? parse(base) : null;
  const prefix = BigInt(Number(prefixText));
  if (baseValue === null || prefix < 0n || prefix > bits) return false;
  if (prefix === 0n) return true;
  const shift = bits - prefix;
  return address >> shift === baseValue >> shift;
}

export function isCloudflarePeer(ip: string): boolean {
  const v4 = ipv4ToBigInt(ip);
  if (v4 !== null) {
    return CLOUDFLARE_IPV4_RANGES.some((cidr) =>
      ipInCidr(v4, cidr, ipv4ToBigInt, 32n)
    );
  }
  const v6 = ipv6ToBigInt(ip);
  if (v6 !== null) {
    // IPv4-mapped peers (::ffff:a.b.c.d) are judged by the embedded
    // IPv4 address against the IPv4 egress ranges.
    if (v6 >> 32n === 0xffffn) {
      const embedded = v6 & 0xffffffffn;
      return CLOUDFLARE_IPV4_RANGES.some((cidr) =>
        ipInCidr(embedded, cidr, ipv4ToBigInt, 32n)
      );
    }
    return CLOUDFLARE_IPV6_RANGES.some((cidr) =>
      ipInCidr(v6, cidr, ipv6ToBigInt, 128n)
    );
  }
  return false;
}

/**
 * Canonical spelling of one client address: IPv4-mapped IPv6 forms
 * unwrap to the embedded IPv4 address so one client cannot split
 * across spellings. The result stays a real IP address, safe for
 * consumers that persist or forward it as one.
 */
export function normalizedClientIp(ip: string): string {
  if (IPV4_REGEX.test(ip)) return ip;
  const value = ipv6ToBigInt(ip);
  if (value === null) return ip;
  if (value >> 32n === 0xffffn) {
    return dottedIpv4(value & 0xffffffffn);
  }
  return ip;
}

function dottedIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 0xffn))
    .join('.');
}

/**
 * Embedded IPv4 of a NAT64-translated address, or null. The
 * well-known prefix 64:ff9b::/96 (RFC 6052) carries the IPv4 in the
 * final 32 bits; the local-use 64:ff9b:1::/48 (RFC 8215) embeds it
 * across bits 48-63 and 72-87, around the reserved zero octet.
 * Behind carrier NAT64 — a common mobile path —
 * distinct shoppers differ only in that embedded address, so the
 * one-subscriber-per-/64 assumption is false for these prefixes.
 */
function nat64EmbeddedIpv4(value: bigint): string | null {
  if (value >> 32n === 0x64ff9bn << 64n) {
    return dottedIpv4(value & 0xffffffffn);
  }
  if (value >> 80n === 0x64ff9b0001n) {
    const reservedOctet = (value >> 56n) & 0xffn;
    if (reservedOctet !== 0n) return null;
    const upper = (value >> 64n) & 0xffffn;
    const lower = (value >> 40n) & 0xffffn;
    return dottedIpv4((upper << 16n) | lower);
  }
  return null;
}

/**
 * Quota identity for a verified visitor address. IPv6 visitors are
 * bucketed by their /64 network so rotating the interface identifier
 * cannot mint a fresh budget — except NAT64-translated visitors,
 * whose /64 is the shared translation prefix: they key on the
 * embedded IPv4 instead, or every NAT64 shopper would collapse into
 * one bucket. This is a quota key, not an IP address: only the
 * trusted cart identifier may return it.
 */
export function visitorQuotaIdentity(ip: string): string {
  const normalized = normalizedClientIp(ip);
  if (IPV4_REGEX.test(normalized)) return normalized;
  const value = ipv6ToBigInt(normalized);
  if (value === null) return normalized;
  const nat64 = nat64EmbeddedIpv4(value);
  if (nat64 !== null) return nat64;
  const groups = [48n, 32n, 16n, 0n].map((shift) =>
    Number((value >> (64n + shift)) & 0xffffn).toString(16)
  );
  return `${groups.join(':')}::/64`;
}

/**
 * Platform-verified immediate peer candidates, in trust order: the
 * platform address, x-real-ip (only when the deployment guarantees the
 * edge overwrites it), and the last x-vercel-forwarded-for hop. That
 * header is set by Vercel's platform itself, so it is only evidence on
 * Vercel (VERCEL=1): a self-hosted trusted-proxy assertion says nothing
 * about who writes it, and a forged value must never unlock
 * CF-Connecting-IP trust.
 */
export function platformPeerIp(
  request: NextRequest,
  allowProxyHeaders: boolean
): string | null {
  const requestWithIp = request as NextRequest & { ip?: string };
  if (requestWithIp.ip && isValidIP(requestWithIp.ip)) return requestWithIp.ip;
  if (!allowProxyHeaders) return null;
  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIP(realIp)) return realIp;
  if (process.env.VERCEL !== '1') return null;
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwarded) {
    const hops = vercelForwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => isValidIP(hop));
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return null;
}

/**
 * Visitor address from CF-Connecting-IP, but only when the immediate
 * platform-verified peer is itself a Cloudflare egress and a CF-Ray
 * header is present. A Cloudflare peer proves the request traversed
 * Cloudflare, and a proxied zone overwrites CF-Connecting-IP at its
 * edge; a direct-to-origin caller forging both headers has a
 * non-Cloudflare peer address and gets null here.
 *
 * Residual risk: a caller originating from Cloudflare egress itself
 * (e.g. a Worker fetching the origin directly) can still set these
 * headers. Closing that fully is an infrastructure control — restrict
 * origin ingress to the proxied zone (Authenticated Origin Pulls) —
 * and is a hard deploy prerequisite for relying on this trust; see
 * docs/deploy/shared-cart-rollout.md. The value is only ever a quota
 * identity, never an authentication credential.
 */
export function verifiedCloudflareVisitorIp(
  request: NextRequest,
  peerIp: string | null
): string | null {
  const cloudflareIp = request.headers.get('cf-connecting-ip');
  if (
    peerIp &&
    isCloudflarePeer(peerIp) &&
    request.headers.get('cf-ray') &&
    cloudflareIp &&
    isValidIP(cloudflareIp)
  ) {
    return normalizedClientIp(cloudflareIp);
  }
  return null;
}
