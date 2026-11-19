/**
 * PiggyVest egress relay: request signing and verification.
 *
 * Header: x-baci-relay-auth: v1.<unix-seconds>.<nonce-hex>.<hmac-sha256-hex>
 * HMAC input (newline separated):
 *   baci-relay-v1, timestamp, nonce, METHOD, request-target (path + query,
 *   exactly as sent), sha256-hex(body)
 *
 * apps/web/src/lib/piggyvest/egress-relay.ts implements the signing side of
 * the same format; both test suites pin the same cross-test vector.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const RELAY_AUTH_HEADER = 'x-baci-relay-auth';
export const MAX_SKEW_SECONDS = 60;
// Longest a valid signature can still be inside the skew window, plus margin.
const REPLAY_TTL_MS = (MAX_SKEW_SECONDS * 2 + 10) * 1000;
const HEADER_PATTERN = /^v1\.(\d{1,12})\.([0-9a-f]{16,64})\.([0-9a-f]{64})$/;

export function sha256Hex(body) {
  return createHash('sha256').update(body).digest('hex');
}

function signingInput({ timestamp, nonce, method, target, body }) {
  return [
    'baci-relay-v1',
    String(timestamp),
    nonce,
    method.toUpperCase(),
    target,
    sha256Hex(body),
  ].join('\n');
}

export function signRelayRequest({
  secret,
  method,
  target,
  body = Buffer.alloc(0),
  timestamp,
  nonce,
}) {
  const signature = createHmac('sha256', secret)
    .update(signingInput({ timestamp, nonce, method, target, body }))
    .digest('hex');
  return `v1.${timestamp}.${nonce}.${signature}`;
}

/**
 * Bounded set of recently accepted signatures. Expiry runs on a monotonic
 * clock: the wall clock can be stepped (NTP, manual), and a forward step must
 * not sweep a signature that becomes valid again once the clock is corrected.
 */
export function createReplayCache({
  ttlMs = REPLAY_TTL_MS,
  maxEntries = 10_000,
  now = () => performance.now(),
} = {}) {
  const seen = new Map();
  function sweep(current) {
    for (const [key, expires] of seen) {
      if (expires > current) break; // insertion order == expiry order
      seen.delete(key);
    }
  }
  return {
    has(key) {
      sweep(now());
      return seen.has(key);
    },
    /** Returns false when full: the caller must fail closed. */
    add(key) {
      const current = now();
      sweep(current);
      if (seen.size >= maxEntries) return false;
      seen.set(key, current + ttlMs);
      return true;
    },
  };
}

/**
 * @returns {{ok: true, signature: string} | {ok: false, reason: string}}
 * Reasons: no_secret, missing, malformed, stale, predates_start, bad_signature.
 * Replay detection is the caller's job (cache after a successful verify).
 */
export function verifyRelayRequest({
  secret,
  header,
  method,
  target,
  body,
  nowSeconds,
  notBeforeSeconds = 0,
}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    return { ok: false, reason: 'no_secret' };
  }
  if (typeof header !== 'string' || header === '') {
    return { ok: false, reason: 'missing' };
  }
  const match = HEADER_PATTERN.exec(header);
  if (!match) return { ok: false, reason: 'malformed' };
  const [, timestampText, nonce, received] = match;
  const timestamp = Number(timestampText);
  if (Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  // The replay cache is in memory: after a restart, anything signed before
  // this process started could be a captured request, so refuse it.
  if (timestamp < notBeforeSeconds) {
    return { ok: false, reason: 'predates_start' };
  }
  const expected = signRelayRequest({
    secret,
    method,
    target,
    body,
    timestamp,
    nonce,
  }).split('.')[3];
  const equal = timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(received, 'utf8')
  );
  return equal
    ? { ok: true, signature: received }
    : { ok: false, reason: 'bad_signature' };
}
