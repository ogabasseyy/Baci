const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8Bytes(input: string): Uint8Array {
  return textEncoder.encode(input);
}

export function utf8ByteLength(input: string): number {
  return textEncoder.encode(input).byteLength;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLength));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(textEncoder.encode(JSON.stringify(value)));
}

export function base64UrlDecodeString(input: string): string {
  return textDecoder.decode(base64UrlDecode(input));
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const bytesA = textEncoder.encode(a);
  const bytesB = textEncoder.encode(b);
  const len = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? textEncoder.encode(input) : input;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Base64Url(
  message: string,
  secret: string
): Promise<string> {
  const keyBytes = textEncoder.encode(secret);
  const msgBytes = textEncoder.encode(message);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, msgBytes);
  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifyHmacSha256Base64Url(
  message: string,
  signatureBase64Url: string,
  secret: string
): Promise<boolean> {
  const expected = await hmacSha256Base64Url(message, secret);
  return constantTimeEqualStrings(expected, signatureBase64Url);
}

/**
 * Normalizes a quiz answer key identically to `public.quiz_normalize_answer_key`:
 * `lower(btrim(COALESCE(p_answer, '')))`.
 */
export function normalizeQuizAnswerKey(
  answer: string | null | undefined
): string {
  return (answer ?? '').trim().toLowerCase();
}

/**
 * Computes `public.quiz_answer_key_hash(p_answer)`.
 */
export function quizAnswerKeyHash(
  answer: string | null | undefined
): Promise<string> {
  return sha256Hex(normalizeQuizAnswerKey(answer));
}

export async function quizAnswerKeyMatches(
  answer: string | null | undefined,
  expectedHash: string
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    return false;
  }
  const actual = await quizAnswerKeyHash(answer);
  return constantTimeEqualStrings(actual, expectedHash.toLowerCase());
}

/**
 * Computes `private.quiz_public_leaderboard_alias(event_id, customer_id)`:
 * `'Player-' || upper(substr(sha256(event_id || ':' || customer_id), 1, 8))`.
 */
export async function quizPublicLeaderboardAlias(
  eventId: string,
  customerId: string
): Promise<string> {
  const digest = await sha256Hex(`${eventId}:${customerId}`);
  return `Player-${digest.slice(0, 8).toUpperCase()}`;
}

/**
 * Deterministic uint32 hash for shard routing (`hash(eventId, userId) mod S`).
 */
export async function computeShardHashUint32(
  eventId: string,
  userId: string
): Promise<number> {
  const digest = await sha256Hex(`${eventId}:${userId}`);
  return Number.parseInt(digest.slice(0, 8), 16) >>> 0;
}

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
] as const;

const MD5_K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000) >>> 0
);

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function toHexLe32(n: number): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Pure TypeScript RFC 1321 MD5 digest matching `pg_catalog.md5(text)` on UTF-8 input.
 * Used for deterministic variant and option-order selection without external packages
 * or Node-only crypto bindings.
 */
export function md5Hex(input: string): string {
  const msg = textEncoder.encode(input);
  const bitLen = msg.length * 8;
  const paddedLen = Math.ceil((msg.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msg.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x1_0000_0000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f = 0;
      let g = 0;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const word = view.getUint32(offset + g * 4, true);
      const k = MD5_K[i] ?? 0;
      const shift = MD5_SHIFTS[i] ?? 0;
      const sum = (a + f + k + word) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl32(sum, shift)) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return `${toHexLe32(a0)}${toHexLe32(b0)}${toHexLe32(c0)}${toHexLe32(d0)}`;
}
