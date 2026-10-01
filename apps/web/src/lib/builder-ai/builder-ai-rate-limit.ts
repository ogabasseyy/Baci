const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 10;
const usage = new Map<string, { count: number; resetAt: number }>();
let nextCleanupAt = 0;

export interface BuilderAiRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

export function checkBuilderAiRateLimit(
  identifier: string,
  now: number = Date.now()
): BuilderAiRateLimitResult {
  if (now >= nextCleanupAt) {
    for (const [key, value] of usage) {
      if (value.resetAt <= now) usage.delete(key);
    }
    nextCleanupAt = now + WINDOW_MS;
  }
  const existing = usage.get(identifier);
  if (!existing || existing.resetAt <= now) {
    usage.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return {
      allowed: true,
      remaining: REQUESTS_PER_WINDOW - 1,
      resetIn: WINDOW_MS,
    };
  }
  if (existing.count >= REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetIn: existing.resetAt - now };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: REQUESTS_PER_WINDOW - existing.count,
    resetIn: existing.resetAt - now,
  };
}
