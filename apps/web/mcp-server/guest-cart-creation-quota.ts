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
// IPv6 callers share one bucket per /64: a single allocation otherwise
// yields a fresh 600-creation budget per source address.
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

// Quota-bucket key: IPv4 addresses (and opaque identities) are used
// as-is; IPv6 addresses collapse to their /64 so all spellings of one
// allocation — full, compressed, mixed-case, zoned — share one bucket
// and rotating source addresses cannot mint fresh budgets.
export function quotaKeyForIp(ip: string): string {
  if (!ip.includes(':')) return ip;
  const withoutZone = ip.split('%')[0];
  const embeddedV4 = withoutZone.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  if (embeddedV4) return embeddedV4[0];
  const halves = withoutZone.split('::');
  let groups: string[];
  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    groups = [
      ...head,
      ...Array(Math.max(0, missing)).fill('0'),
      ...tail,
    ];
  } else {
    groups = withoutZone.split(':');
  }
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=[0-9a-f]+$)/i, '').toLowerCase() || '0')
    .join(':');
}

function inspectQuota(ip: string, now: number): GuestCartQuotaVerdict {
  const entry = quotaByIp.get(quotaKeyForIp(ip));
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
 * Atomically reserves one anonymous creation from the caller's budget. The
 * check and the increment run synchronously with no await between them, so
 * concurrent in-flight creations cannot all observe remaining budget and
 * then overshoot it: at most MAX reservations are outstanding per window.
 * Callers must refund the reservation when no cart ends up persisted.
 */
export function reserveGuestCartCreation(ip: string): GuestCartQuotaVerdict {
  const now = Date.now();
  const verdict = inspectQuota(ip, now);
  if (!verdict.allowed) return verdict;
  const key = quotaKeyForIp(ip);
  const entry = quotaByIp.get(key);
  if (entry && now - entry.windowStart < GUEST_CART_QUOTA_WINDOW_MS) {
    entry.count += 1;
  } else {
    quotaByIp.set(key, { count: 1, windowStart: now });
  }
  return verdict;
}

/**
 * Returns one reservation to the caller's budget after a creation failed
 * before persistence (validation rejection, store error). Never drops the
 * count below zero; a rolled-over window keeps its fresh budget instead of
 * receiving a refund for the previous window.
 */
export function refundGuestCartCreation(ip: string): void {
  const entry = quotaByIp.get(quotaKeyForIp(ip));
  if (
    entry &&
    Date.now() - entry.windowStart < GUEST_CART_QUOTA_WINDOW_MS &&
    entry.count > 0
  ) {
    entry.count -= 1;
  }
}
