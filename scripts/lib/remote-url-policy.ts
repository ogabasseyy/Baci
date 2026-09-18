function isBlockedIpv4Octets(octets: number[]): boolean {
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
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
  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    // ::ffff:0:0/96 — classify the embedded IPv4 address.
    return isBlockedIpv4Octets([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
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
