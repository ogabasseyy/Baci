// Rolling per-IP budget for anonymous guest-cart creation. A tokenless
// update_ogabassey_guest_cart call mints a fresh cart file, so unbounded
// callers could fill the cart volume; token-bound updates are unaffected.
const QUOTA_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const QUOTA_MAX_CREATIONS = 20; // anonymous carts per IP per window
const QUOTA_MAX_ENTRIES = 10_000; // Max unique IPs to track (prevent memory exhaustion)

interface QuotaEntry {
  count: number;
  windowStart: number;
}

const quotaByIp = new Map<string, QuotaEntry>();

export function consumeGuestCartCreation(ip: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const entry = quotaByIp.get(ip);
  if (!entry || now - entry.windowStart >= QUOTA_WINDOW_MS) {
    if (quotaByIp.size >= QUOTA_MAX_ENTRIES) {
      for (const [existingIp, existingEntry] of quotaByIp.entries()) {
        if (now - existingEntry.windowStart >= QUOTA_WINDOW_MS) {
          quotaByIp.delete(existingIp);
        }
      }
    }
    quotaByIp.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= QUOTA_MAX_CREATIONS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(
        (entry.windowStart + QUOTA_WINDOW_MS - now) / 1000
      ),
    };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
