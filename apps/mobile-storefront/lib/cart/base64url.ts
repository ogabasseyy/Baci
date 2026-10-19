const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64url without relying on a global atob (absent in some runtimes). */
export function decodeBase64UrlToUtf8(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let bytes = '';
  let buffer = 0;
  let bits = 0;
  for (const char of padded) {
    if (char === '=') break;
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
