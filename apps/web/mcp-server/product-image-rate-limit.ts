const IMAGE_WINDOW_MS = 60_000;
const IMAGE_REQUESTS_PER_WINDOW = 240;
const MAX_IMAGE_CLIENTS = 10_000;

interface Entry {
  count: number;
  resetAt: number;
}

export function createProductImageRateLimiter() {
  const entries = new Map<string, Entry>();

  return (ip: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } => {
    const current = entries.get(ip);
    if (!current || now >= current.resetAt) {
      if (entries.size >= MAX_IMAGE_CLIENTS) {
        for (const [clientIp, entry] of entries) {
          if (now >= entry.resetAt) entries.delete(clientIp);
        }
        if (entries.size >= MAX_IMAGE_CLIENTS) {
          return { allowed: false, retryAfterSeconds: Math.ceil(IMAGE_WINDOW_MS / 1000) };
        }
      }
      entries.set(ip, { count: 1, resetAt: now + IMAGE_WINDOW_MS });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= IMAGE_REQUESTS_PER_WINDOW) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }
    current.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

export const checkProductImageRateLimit = createProductImageRateLimiter();
