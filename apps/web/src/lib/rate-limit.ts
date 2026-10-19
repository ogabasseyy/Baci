// Distributed Rate Limiting
// Uses Upstash Redis (shared across all Vercel instances) with in-memory fallback.
// Sliding window algorithm via @upstash/ratelimit SDK.

import { Ratelimit } from '@upstash/ratelimit';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { checkLegacyBridgeRateLimit } from './legacy-bridge-rate-limit';
import {
  getClientIdentifier,
  getTrustedClientIdentifier,
} from './rate-limit-client';
import { rateLimitDiagnostics } from './rate-limit-diagnostics';
import { getRateLimitConfig } from './rate-limit-routes';
import { getRedis } from './redis';

export { getClientIdentifier, getTrustedClientIdentifier };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

export type { RateLimitDiagnostic } from './rate-limit-diagnostics';
export const setRateLimitDiagnosticHook = rateLimitDiagnostics.setHook;

const IMEI_POLL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 120,
  windowMs: 60_000,
};

// ---------------------------------------------------------------------------
// Upstash Ratelimit instances (one per unique config, created lazily)
// ---------------------------------------------------------------------------

const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(config: RateLimitConfig): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const windowSeconds = `${Math.ceil(config.windowMs / 1000)} s` as const;
  const key = `${config.maxRequests}:${windowSeconds}`;

  let limiter = upstashLimiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.maxRequests, windowSeconds),
      prefix: 'baci:ratelimit',
      ephemeralCache: new Map(),
    });
    upstashLimiters.set(key, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// In-memory fallback (when Redis is unavailable)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, { count: number; resetTime: number }>();
const MAX_STORE_SIZE = 10_000;
const PRUNE_BATCH_SIZE = 100;

function pruneStore(now: number): void {
  if (memoryStore.size < MAX_STORE_SIZE) return;
  let pruned = 0;
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetTime) {
      memoryStore.delete(key);
      pruned++;
      if (pruned >= PRUNE_BATCH_SIZE) break;
    }
  }
}

function checkMemoryRateLimit(
  identifier: string,
  pattern: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${identifier}:${pattern}`;
  const now = Date.now();
  pruneStore(now);

  let entry = memoryStore.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + config.windowMs };
  }

  entry.count++;
  memoryStore.set(key, entry);

  const allowed = entry.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - entry.count);

  return {
    allowed,
    limit: config.maxRequests,
    remaining,
    resetTime: entry.resetTime,
  };
}

// ---------------------------------------------------------------------------
// Main entry point (async — uses Redis when available, memory fallback)
// ---------------------------------------------------------------------------

const LEGACY_BRIDGE_PATH = '/api/storefront/cart/legacy';

export function checkRateLimit(request: NextRequest): Promise<RateLimitResult> {
  const pathname = request.nextUrl.pathname;
  const { config, pattern } = getRateLimitConfig(pathname);
  const clientIdentifier = getClientIdentifier(request);

  if (pathname === LEGACY_BRIDGE_PATH) {
    return checkLegacyBridgeRateLimit(
      request,
      pattern,
      config,
      getTrustedClientIdentifier(request),
      applyRateLimit
    );
  }

  return applyRateLimit(clientIdentifier, pattern, config);
}

async function applyRateLimit(
  identifier: string,
  pattern: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // Try Upstash first
  const limiter = getUpstashLimiter(config);
  if (limiter) {
    try {
      const upstashKey = `${identifier}:${pattern}`;
      const result = await limiter.limit(upstashKey);
      void rateLimitDiagnostics.report({
        backend: 'redis',
        reason: 'redis_success',
      });
      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        resetTime: result.reset,
      };
    } catch {
      // Redis error — fall through to in-memory
      void rateLimitDiagnostics.report({
        backend: 'memory',
        reason: 'redis_error',
      });
    }
  } else {
    void rateLimitDiagnostics.report({
      backend: 'memory',
      reason: 'redis_unavailable',
    });
  }

  // Fallback to in-memory
  return checkMemoryRateLimit(identifier, pattern, config);
}

export function checkImeiPollRateLimit(
  request: NextRequest
): Promise<RateLimitResult> {
  return applyRateLimit(
    getClientIdentifier(request),
    '/api/storefront/imei-check/:lookupId:poll',
    IMEI_POLL_RATE_LIMIT
  );
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

export function createRateLimitResponse(
  limit: number,
  remaining: number,
  resetTime: number
): NextResponse {
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((resetTime - Date.now()) / 1000)
  );

  const response = NextResponse.json(
    {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: retryAfterSeconds,
    },
    { status: 429 }
  );

  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', new Date(resetTime).toISOString());
  response.headers.set('Retry-After', retryAfterSeconds.toString());

  return response;
}

// ---------------------------------------------------------------------------
// Cleanup (in-memory fallback only)
// ---------------------------------------------------------------------------

export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.resetTime) {
      memoryStore.delete(key);
    }
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function __resetRateLimitStoreForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '__resetRateLimitStoreForTesting should only be called in test environment'
    );
  }
  memoryStore.clear();
  upstashLimiters.clear();
  rateLimitDiagnostics.reset();
}
