const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64url without relying on a global atob (absent in some runtimes). */
export function decodeBase64UrlToUtf8(value: string): string {
  if (!/^[A-Za-z0-9_+\/-]*={0,2}$/.test(value))
    throw new Error('Invalid base64url value');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const core = padding ? value.slice(0, -padding) : value;
  if (core.length % 4 === 1) throw new Error('Invalid base64url value');
  if (padding) {
    const expected = (4 - (core.length % 4)) % 4;
    if (value.length % 4 !== 0 || padding !== expected)
      throw new Error('Invalid base64url value');
  }
  const normalized = core.replace(/-/g, '+').replace(/_/g, '/');
  // Reject non-canonical encodings whose unused trailing bits are set.
  const remainder = normalized.length % 4;
  if (remainder === 2 || remainder === 3) {
    const last = ALPHABET.indexOf(normalized[normalized.length - 1]);
    const unusedMask = remainder === 2 ? 0x0f : 0x03;
    if (last < 0 || (last & unusedMask) !== 0)
      throw new Error('Invalid base64url value');
  }
  let bytes = '';
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base64url value');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(
    Array.from(
      bytes,
      (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`
    ).join('')
  );
}
