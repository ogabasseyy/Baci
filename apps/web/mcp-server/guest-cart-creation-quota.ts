// Rolling per-IP budget for anonymous guest-cart creation. A tokenless
// update_ogabassey_guest_cart call mints a fresh cart file, so unbounded
// callers could churn the shared pool and evict other shoppers' carts;
// token-bound updates are unaffected.
//
// Calibration: this is a flood guard, not a per-shopper budget. Anonymous
// stateless MCP calls carry no shopper or session identity, so the caller
// IP (the same key the server's global rate limiter uses) is the only
// available distinguisher. NAT and shared egress therefore share one
// bucket; the 600-creations/hour limit tolerates legitimate bursts while
// still binding a flooder to a fraction of the 2,000-cart pool per hour.
export const GUEST_CART_QUOTA_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const GUEST_CART_QUOTA_MAX_CREATIONS = 600; // anonymous carts per IP per window
const QUOTA_MAX_ENTRIES = 10_000; // Max unique IPs to track (prevent memory exhaustion)

interface QuotaEntry {
  count: number;
  windowStart: number;
}

const quotaByIp = new Map<string, QuotaEntry>();

export interface GuestCartQuotaVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Partial-IP logging: keep the routable prefix, drop host bits. IPv4
// keeps its /16; IPv6 keeps its /64, dropping the interface identifier.
function maskIpForLog(ip: string): string {
  // IPv4 first so mapped forms (::ffff:1.2.3.4) mask the embedded address.
  if (/(\d+)\.(\d+)\.(\d+)\.(\d+)/.test(ip))
    return ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.xxx.xxx');
  if (ip.includes(':')) {
    const head = ip.split(':').slice(0, 4).join(':');
    return `${head}:xxxx:xxxx:xxxx:xxxx`;
  }
  return ip;
}

function inspectQuota(ip: string, now: number): GuestCartQuotaVerdict {
  const entry = quotaByIp.get(ip);
  if (entry && now - entry.windowStart < GUEST_CART_QUOTA_WINDOW_MS) {
    if (entry.count >= GUEST_CART_QUOTA_MAX_CREATIONS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(
          (entry.windowStart + GUEST_CART_QUOTA_WINDOW_MS - now) / 1000
        ),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (quotaByIp.size >= QUOTA_MAX_ENTRIES) {
    for (const [existingIp, existingEntry] of quotaByIp.entries()) {
      if (now - existingEntry.windowStart >= GUEST_CART_QUOTA_WINDOW_MS) {
        quotaByIp.delete(existingIp);
      }
    }
    // If still at capacity after cleanup, reject new IPs (DDoS
    // protection): the retry hint is the full window, a constant that
    // stays cheap on the flood path instead of scanning for the oldest
    // expiry.
    if (quotaByIp.size >= QUOTA_MAX_ENTRIES) {
      console.warn(
        JSON.stringify({
          type: 'security',
          event: 'guest_cart_quota_capacity',
          ip: maskIpForLog(ip),
        })
      );
      return {
        allowed: false,
        retryAfterSeconds: GUEST_CART_QUOTA_WINDOW_MS / 1000,
      };
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Checks the creation budget without consuming it. Failed validations and
 * store errors must not burn quota, so callers peek before doing work and
 * consume only after a cart is successfully persisted. Peek-then-consume
 * is not atomic: concurrent in-flight creations can overshoot the limit
 * by their own count, which a flood guard tolerates.
 */
export function peekGuestCartCreation(ip: string): GuestCartQuotaVerdict {
  return inspectQuota(ip, Date.now());
}

/** Records one persisted anonymous cart against the caller's budget. */
export function consumeGuestCartCreation(ip: string): GuestCartQuotaVerdict {
  const now = Date.now();
  const verdict = inspectQuota(ip, now);
  if (!verdict.allowed) return verdict;
  const entry = quotaByIp.get(ip);
  if (entry && now - entry.windowStart < GUEST_CART_QUOTA_WINDOW_MS) {
    entry.count += 1;
  } else {
    quotaByIp.set(ip, { count: 1, windowStart: now });
  }
  return verdict;
}
