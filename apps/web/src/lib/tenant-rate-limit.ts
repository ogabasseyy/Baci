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
let warnedRedisTimeout = false;

export type TenantRateLimitVerdict = 'allowed' | 'denied' | 'unavailable';
type TenantRateLimitConfig = { maxRequests: number; windowMs: number };

export async function checkTenantRateLimit(
  namespace: string,
  tenantId: string,
  config: TenantRateLimitConfig
): Promise<TenantRateLimitVerdict> {
  return (await checkTenantRateLimitDetailed(namespace, tenantId, config))
    .verdict;
}

// Same check, plus the limiter's reset time (epoch ms) on a denial so a
// caller can send an exact Retry-After.
export async function checkTenantRateLimitDetailed(
  namespace: string,
  tenantId: string,
  config: TenantRateLimitConfig
): Promise<{ verdict: TenantRateLimitVerdict; resetAt?: number }> {
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
    return { verdict: 'unavailable' };
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
    if (!result.success) {
      // Abuse signal for budget alerting, unlike the once-per-outage Redis
      // warns above: denial volume is the spike to page on.
      logger.warn({
        message: 'Tenant rate limit budget exhausted',
        namespace,
        tenantId,
      });
      return { verdict: 'denied', resetAt: result.reset };
    }
    // Upstash resolves { success: true, reason: 'timeout' } when Redis stalls
    // past its timeout: a fail-OPEN verdict that never charged the budget.
    // Treat it as an outage so every caller denies closed.
    if (result.reason === 'timeout') {
      if (!warnedRedisTimeout) {
        warnedRedisTimeout = true;
        logger.warn({
          message: 'Tenant rate limit timed out; denying closed',
          namespace,
          tenantId,
        });
      }
      return { verdict: 'unavailable' };
    }
    return { verdict: 'allowed' };
  } catch {
    if (!warnedRedisError) {
      warnedRedisError = true;
      logger.warn({
        message: 'Tenant rate limit error; denying closed',
        namespace,
        tenantId,
      });
    }
    return { verdict: 'unavailable' };
  }
}
