import { Ratelimit } from '@upstash/ratelimit';
import { logger } from './logger';
import { getRedis } from './redis';

// Route-level tenant budgets on Upstash Redis (the same backend as the proxy
// limiter) for keys the proxy cannot derive, such as merchant IDs resolved
// inside the route. No Supabase involved, so user-facing routes can enforce
// tenant-wide AI/spend budgets without a service-role client.
//
// Fails closed: Redis unavailable or erroring denies the call. Deliberately
// no ephemeral cache — a cached allow during an outage would silently unlock
// the budget this guard exists to protect.

const tenantLimiters = new Map<string, Ratelimit>();
// Outage signals fire once per process: every request denies closed during
// a Redis outage, and per-request warnings would flood the log instead of
// paging once.
let warnedRedisUnavailable = false;
let warnedRedisError = false;

export async function checkTenantRateLimit(
  namespace: string,
  tenantId: string,
  config: { maxRequests: number; windowMs: number }
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    if (!warnedRedisUnavailable) {
      warnedRedisUnavailable = true;
      logger.warn({
        message: 'Tenant rate limit Redis unavailable; denying closed',
        namespace,
        tenantId,
      });
    }
    return false;
  }

  const windowSeconds = `${Math.ceil(config.windowMs / 1000)} s` as const;
  const cacheKey = `${config.maxRequests}:${windowSeconds}`;
  let limiter = tenantLimiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.maxRequests, windowSeconds),
      prefix: 'baci:tenant-ratelimit',
    });
    tenantLimiters.set(cacheKey, limiter);
  }

  try {
    const result = await limiter.limit(`${namespace}:${tenantId}`);
    return result.success;
  } catch {
    if (!warnedRedisError) {
      warnedRedisError = true;
      logger.warn({
        message: 'Tenant rate limit error; denying closed',
        namespace,
        tenantId,
      });
    }
    return false;
  }
}
