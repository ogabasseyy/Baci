function isBlockedIpv4Octets(octets: number[]): boolean {
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    // Shared-address (CGNAT) space also reaches private overlays.
    (a === 100 && b >= 64 && b <= 127) ||
    // Benchmarking range is routed to internal test infrastructure.
    (a === 198 && (b === 18 || b === 19)) ||
    // Deprecated 6to4 relay-anycast block (RFC 7526): the whole /24 is
    // non-globally reachable, so no per-address exception applies.
    (a === 192 && b === 88 && octets[2] === 99) ||
    // IETF protocol assignments (RFC 6890), including the NAT64
    // discovery range (RFC 7050): non-globally reachable, and no
    // global anycast origin lives in 192.0.0.0/24.
    (a === 192 && b === 0 && octets[2] === 0) ||
    // Documentation TEST-NET ranges never appear as real origins.
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    // Multicast and reserved-for-future-use space is never globally
    // routable to a real origin.
    a >= 224 || a === 0;
}

/** Strictly parse an IPv6 literal into eight 16-bit groups. */
function parseIpv6Groups(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(host)) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const parseSide = (text: string): number[] | null => {
    if (text === '') return [];
    const groups: number[] = [];
    const parts = text.split(':');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('.')) {
        // Embedded IPv4 occupies the final 32 bits only.
        if (i !== parts.length - 1) return null;
        const bytes = part.split('.');
        if (bytes.length !== 4) return null;
        const nums = bytes.map(Number);
        if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        groups.push(nums[0] * 256 + nums[1], nums[2] * 256 + nums[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
        groups.push(parseInt(part, 16));
      }
    }
    return groups;
  };
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (!left || !right) return null;
  if (halves.length === 2) {
    if (left.length + right.length > 7) return null;
    return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

function isBlockedIpv6Literal(host: string): boolean {
  const groups = parseIpv6Groups(host);
  // Fail closed: a colon-bearing hostname that is not valid IPv6 is
  // malformed and must never be treated as a public destination.
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    // ::ffff:0:0/96 — classify the embedded IPv4 address first: a public
    // translation must stay reachable while private ones stay blocked.
    return isBlockedIpv4Octets([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  // Default deny: accept only global unicast 2000::/3. Every other space
  // (loopback, multicast, link-local, unique-local, documentation,
  // translation, discard) is not a real origin.
  if ((g0 & 0xe000) !== 0x2000) return true;
  // Carve-outs inside global unicast that never originate traffic.
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return true; // 2001:10::/28 ORCHIDv1
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return true; // 2001:20::/28 ORCHIDv2 (RFC 7343)
  if (g0 === 0x2001 && g1 === 0x0000) return true; // 2001::/32 Teredo
  if (g0 === 0x2002) return true; // 2002::/16 6to4
  if (g0 === 0x2001 && g1 === 0x0002) return true; // 2001:2::/48 benchmarking
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x3fff && (g1 & 0xf000) === 0x0000) return true; // 3fff::/20 documentation
  return false;
}

function isBlockedRemoteHost(hostname: string): boolean {
  // URL.hostname keeps IPv6 brackets ("[::1]"); strip them so the literal
  // checks below see the bare address.
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[(.*)\]$/, '$1');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata') return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    // IPv6 range checks apply to IP literals only: a plain DNS hostname
    // such as fcdn.example.com merely starts with "fc" but is not an
    // IPv6 unique-local address.
    if (!host.includes(':')) return false;
    return isBlockedIpv6Literal(host);
  }
  return isBlockedIpv4Octets(octets);
}

export function validateRemoteUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedRemoteHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}
