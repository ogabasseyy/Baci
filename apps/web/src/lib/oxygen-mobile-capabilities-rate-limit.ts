import { applyRateLimit, type RateLimitResult } from './rate-limit';

/** Read-only capability checks can use the normal bounded fallback. */
export function checkOxygenMobileCapabilitiesRateLimit(
  userId: string
): Promise<RateLimitResult> {
  return applyRateLimit(userId, 'oxygen-mobile-capabilities', {
    maxRequests: 10,
    windowMs: 60_000,
  });
}
