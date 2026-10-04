import { PilotAcquireError } from './inventory-store.mjs';

// SSRF guard for pilot fetches: deny loopback, private, link-local
// (covers the 169.254.169.254 cloud-metadata address), and other
// non-public IP literals, plus localhost names. Plain hostnames stay
// operator-trusted — this is an offline operator CLI over
// operator-supplied inventory URLs, so DNS rebinding is out of scope —
// but a mistyped or malicious literal can no longer make the operator
// workstation fetch internal endpoints.
export function assertPublicFetchUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
  } catch {
    throw new PilotAcquireError(`acquire: invalid URL`);
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new PilotAcquireError(
      `acquire: refusing loopback fetch destination "${hostname}"`
    );
  }
  if (isDeniedIpLiteral(hostname)) {
    throw new PilotAcquireError(
      `acquire: refusing non-public fetch destination "${hostname}"`
    );
  }
}

function isDeniedIpLiteral(host) {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.every((n) => n <= 255)) {
      const [a, b, c] = octets;
      return (
        a === 0 || // 0.0.0.0/8 ("this network")
        a === 10 || // 10.0.0.0/8
        (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
        a === 127 || // 127.0.0.0/8
        (a === 169 && b === 254) || // 169.254.0.0/16
        (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24, 192.0.2.0/24
        (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 (6to4 relay)
        (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
        (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
        (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 TEST-NET-3
        a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
      );
    }
    // Over-wide "octets" ('999.1.1.1') are not valid literals, but they
    // are still numeric-looking, so they fall through to the deny below
    // instead of passing as hostnames.
  }
  // Obfuscated numeric forms: getaddrinfo parses decimal ('2130706433'
  // is 127.0.0.1), short ('127.1'), octal ('0177.0.0.1' on glibc), and
  // hex ('0x7f.0.0.1') IPs that never match canonical dotted-quad.
  // Canonicalize the pure-decimal form precisely; fail closed on every
  // other all-numeric host (real hostnames always carry a non-numeric
  // label, so '0xpress.example' still passes through to DNS).
  if (/^[0-9]+$/.test(host)) {
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n > 0xffffffff) {
      return true;
    }
    return isDeniedIpLiteral(
      [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(
        '.'
      )
    );
  }
  if (/^((0x[0-9a-f]+|\d+)[.]?)+$/i.test(host)) {
    return true;
  }
  if (!host.includes(':') || host.includes('%')) {
    return host.includes('%');
  }
  // WHATWG URL serializes mapped v4 in hex ('::ffff:808:808'), so
  // accept both spellings and judge the embedded v4 address.
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    return isDeniedIpLiteral(mapped[1]);
  }
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isDeniedIpLiteral(
      `${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`
    );
  }
  // Expand compressed forms so prefix checks see true hextets:
  // positional parsing of '::' misreads '2001::db8:1' (second hextet 0)
  // and misses uncompressed '0:...:1' entirely. Unparseable v6 fails
  // closed (no legitimate fetch target looks like that).
  const hextets = expandIPv6(host);
  if (!hextets) {
    return true;
  }
  const h = hextets.map((part) => Number.parseInt(part, 16));
  // v4-mapped ::ffff:0:0/96 in the uncompressed spelling: judge the
  // embedded v4 (dotted and ::ffff:hex spellings returned earlier).
  if (
    h[0] === 0 &&
    h[1] === 0 &&
    h[2] === 0 &&
    h[3] === 0 &&
    h[4] === 0 &&
    h[5] === 0xffff
  ) {
    return isDeniedIpLiteral(
      `${(h[6] >>> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >>> 8) & 0xff}.${h[7] & 0xff}`
    );
  }
  const [first, second, third, fourth, fifth, sixth] = h;
  return (
    first === 0 || // 0000::/8 reserved (::, ::1, compat)
    (first >= 0xfe80 && first <= 0xfebf) || // fe80::/10 link-local
    (first >= 0xfc00 && first <= 0xfdff) || // fc00::/7 unique-local
    first >= 0xff00 || // ff00::/8 multicast
    (first === 0x2001 && second === 0xdb8) || // 2001:db8::/32 documentation
    (first === 0x2001 && second === 0x0) || // 2001::/32 Teredo tunneling
    (first === 0x2001 && second === 0x2 && third === 0x0) || // 2001:2::/48 benchmarking
    (first === 0x64 &&
      second === 0xff9b &&
      ((third === 0x0 && fourth === 0x0 && fifth === 0x0 && sixth === 0x0) ||
        third === 0x1)) || // 64:ff9b::/96 + :1::/48 translation
    (first === 0x100 && second === 0x0 && third === 0x0 && fourth === 0x0) // 100::/64 discard
  );
}

function expandIPv6(host) {
  const halves = host.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const parts = [...head, ...tail];
  if (
    parts.some((part) => part.includes('.') || !/^[0-9a-f]{1,4}$/i.test(part))
  ) {
    return null;
  }
  if (halves.length === 1) {
    return parts.length === 8 ? parts : null;
  }
  const missing = 8 - parts.length;
  if (missing < 0) {
    return null;
  }
  return [...head, ...Array(missing).fill('0'), ...tail];
}
