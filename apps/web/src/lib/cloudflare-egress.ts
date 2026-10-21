// Cloudflare egress verification for the CF-Connecting-IP trust boundary.
//
// Behind Cloudflare, Vercel overwrites x-forwarded-for with the peer
// address and does not forward external IPs, so every Vercel-set header
// carries the shared egress IP and only CF-Connecting-IP names the
// shopper. These published egress ranges verify the peer really is
// Cloudflare's network before that header is trusted. Staleness degrades
// conservatively: an egress IP missing from this list simply falls back
// to egress-shared bucketing (status quo), never to trusting a forged
// header. Refresh from the source URLs if Cloudflare announces new
// ranges. Edge-compatible: no Node.js builtins.

// https://www.cloudflare.com/ips-v4 (synced 2026-10-21)
const CLOUDFLARE_EGRESS_V4 = [
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
];

// https://www.cloudflare.com/ips-v6 (synced 2026-10-21)
const CLOUDFLARE_EGRESS_V6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const IPV6_REGEX =
  /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^::$/;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    n = n * 256 + byte;
  }
  return n;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return false;
  const [base, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  const ipValue = ipv4ToInt(ip);
  const baseValue = base ? ipv4ToInt(base) : null;
  if (
    ipValue === null ||
    baseValue === null ||
    !Number.isInteger(bits) ||
    bits < 0 ||
    bits > 32
  )
    return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipValue & mask) >>> 0 === (baseValue & mask) >>> 0;
}

function expandIPv6(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  for (const group of [...head, ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return false;
  const [base, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  const ipGroups = expandIPv6(ip);
  const baseGroups = base ? expandIPv6(base) : null;
  if (
    !ipGroups ||
    !baseGroups ||
    !Number.isInteger(bits) ||
    bits < 0 ||
    bits > 128
  )
    return false;
  const fullGroups = Math.floor(bits / 16);
  for (let i = 0; i < fullGroups; i++) {
    if (ipGroups[i] !== baseGroups[i]) return false;
  }
  const rest = bits % 16;
  if (rest > 0) {
    const mask = (0xffff << (16 - rest)) & 0xffff;
    if ((ipGroups[fullGroups] & mask) !== (baseGroups[fullGroups] & mask))
      return false;
  }
  return true;
}

/** True when the IP belongs to Cloudflare's published egress ranges. */
export function isCloudflareEgressIp(ip: string): boolean {
  if (IPV4_REGEX.test(ip)) {
    return CLOUDFLARE_EGRESS_V4.some((cidr) => ipv4InCidr(ip, cidr));
  }
  if (IPV6_REGEX.test(ip)) {
    return CLOUDFLARE_EGRESS_V6.some((cidr) => ipv6InCidr(ip, cidr));
  }
  return false;
}
