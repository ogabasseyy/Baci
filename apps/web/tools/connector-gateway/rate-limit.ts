/**
 * Per-key + per-IP fixed-window rate limiter (pure, in-memory).
 *
 * Tool routes are limited by credential (sha256 hex of the presented
 * bearer, never the credential itself) and by client IP independently:
 * one hot key cannot starve other grants, and one hot IP cannot starve
 * other clients beyond the shared IP budget. Owner/discovery routes pass
 * `keyId: null` and consume only the IP budget.
 */

export interface RateLimiterOptions {
  windowMs: number;
  maxPerKey: number;
  maxPerIp: number;
}

export interface RateLimitInput {
  /** Credential identifier (hash hex) or null for key-less routes. */
  keyId: string | null;
  ip: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the most constrained window resets (0 allowed). */
  retryAfterMs: number;
  /** Which budget denied the request; null when allowed. */
  limitedBy: 'ip' | 'key' | null;
}

interface WindowCounter {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  check(input: RateLimitInput, now?: number): RateLimitDecision;
}

/** Normalize IPv4-mapped IPv6 loopback/peers for stable budget keys. */
function normalizePeer(peer: string): string {
  return peer.startsWith('::ffff:') ? peer.slice('::ffff:'.length) : peer;
}

/**
 * Attribute the IP budget. Only a socket peer in `trustedProxies` (the
 * local path-filtering proxy) may supply X-Forwarded-For, and only its
 * leftmost entry is used; every other peer is keyed by socket address,
 * so spoofed forwarded headers from untrusted clients are ignored.
 */
export function resolveClientIp(input: {
  socketAddress: string;
  forwardedFor: string | string[] | undefined;
  trustedProxies: readonly string[];
}): string {
  const peer = normalizePeer(input.socketAddress);
  if (!input.trustedProxies.includes(peer)) {
    return peer;
  }
  const header = Array.isArray(input.forwardedFor)
    ? input.forwardedFor[0]
    : input.forwardedFor;
  const candidate = header?.split(',')[0]?.trim();
  return candidate && candidate.length > 0 ? candidate : peer;
}

function hit(
  store: Map<string, WindowCounter>,
  id: string,
  now: number,
  windowMs: number,
  max: number
): { limited: boolean; retryAfterMs: number } {
  const entry = store.get(id);
  if (entry === undefined || entry.resetAt <= now) {
    store.set(id, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterMs: 0 };
  }
  entry.count += 1;
  if (entry.count > max) {
    return { limited: true, retryAfterMs: entry.resetAt - now };
  }
  return { limited: false, retryAfterMs: 0 };
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const keyHits = new Map<string, WindowCounter>();
  const ipHits = new Map<string, WindowCounter>();
  const sweeps = [keyHits, ipHits].map((store) => ({
    store,
    iterator: null as Iterator<[string, WindowCounter]> | null,
  }));

  return {
    check(input: RateLimitInput, now: number = Date.now()): RateLimitDecision {
      // Resume each sweep across requests; never scan all live counters
      // on one request once the maps exceed the cleanup threshold.
      if (keyHits.size + ipHits.size > 20_000) {
        for (const sweep of sweeps) {
          sweep.iterator ??= sweep.store[Symbol.iterator]();
          for (let scanned = 0; scanned < 128; scanned += 1) {
            const next = sweep.iterator.next();
            if (next.done) {
              sweep.iterator = null;
              break;
            }
            const [id, entry] = next.value;
            if (entry.resetAt <= now) {
              sweep.store.delete(id);
            }
          }
        }
      }
      // IP budget first: a request already denied by IP must not
      // allocate or advance a key counter.
      const ip = hit(ipHits, input.ip, now, options.windowMs, options.maxPerIp);
      if (ip.limited) {
        return {
          allowed: false,
          retryAfterMs: Math.max(ip.retryAfterMs, 0),
          limitedBy: 'ip',
        };
      }
      if (input.keyId === null) {
        return { allowed: true, retryAfterMs: 0, limitedBy: null };
      }
      const key = hit(
        keyHits,
        `key:${input.keyId}`,
        now,
        options.windowMs,
        options.maxPerKey
      );
      if (!key.limited) {
        return { allowed: true, retryAfterMs: 0, limitedBy: null };
      }
      return {
        allowed: false,
        retryAfterMs: Math.max(key.retryAfterMs, 0),
        limitedBy: 'key',
      };
    },
  };
}
