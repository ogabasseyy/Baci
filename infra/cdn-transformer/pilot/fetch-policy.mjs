import { PilotAcquireError } from './acquire.mjs';

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
      const [a, b] = octets;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
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
  if (host === '::' || host === '::1' || host.startsWith('::')) {
    return true;
  }
  const first = Number.parseInt(host.split(':')[0], 16);
  if (Number.isNaN(first)) {
    return false;
  }
  return (
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xfc00 && first <= 0xfdff) ||
    first >= 0xff00
  );
}
