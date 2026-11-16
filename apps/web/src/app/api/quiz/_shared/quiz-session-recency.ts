import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { DEADLINE_PASSED, withinDeadline } from './within-deadline';

// Remembers which access tokens Supabase Auth confirmed recently. The answer
// route verifies the token's signature on every request and asks Supabase
// Auth about the session at most once per token per
// RECENT_SESSION_CHECK_TTL_MS, so a signed-out or revoked session stops
// answering within about a minute instead of at token expiry, without a
// Supabase Auth round trip on every answer.
//
// Two layers:
// - this server instance's own memory, checked first and free;
// - the shared Redis store, so a check made by one instance counts for all
//   of them. Memory alone is per instance: a live quiz is served by several
//   instances, each of which would ask Supabase Auth about the same token,
//   and most answers would land on an instance that had not asked yet.
// The shared store only ever saves a Supabase Auth call. When it is not
// configured, slow or failing, the caller asks Supabase Auth exactly as if
// nothing had been remembered.

export const RECENT_SESSION_CHECK_TTL_MS = 60_000;
const MAX_TRACKED_TOKENS = 50_000;
const SHARED_KEY_PREFIX = 'quiz:session-check:v1:';
// The answer path must not wait on the store: past this it asks Supabase Auth.
const SHARED_STORE_DEADLINE_MS = 150;
// Server clocks differ by a little. A stored check time further ahead of this
// instance's clock than this is not trusted.
const MAX_CLOCK_SKEW_MS = 5_000;
const SHARED_STORE_WARNING_INTERVAL_MS = 5 * 60_000;

// Insertion order is age order: a token is re-inserted on every new check.
const checkedAtByToken = new Map<string, number>();
let lastSharedStoreWarningAt = Number.NEGATIVE_INFINITY;

// Tokens are kept as hashes so neither a memory dump of this map nor the
// shared store holds a credential.
function keyFor(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** This instance's own memory only. */
export function hasRecentSessionCheck(
  token: string,
  now: number = Date.now()
): boolean {
  const key = keyFor(token);
  const checkedAt = checkedAtByToken.get(key);
  if (checkedAt === undefined) return false;
  if (now - checkedAt >= RECENT_SESSION_CHECK_TTL_MS) {
    checkedAtByToken.delete(key);
    return false;
  }
  return true;
}

/** This instance's own memory only. */
export function recordSessionCheck(
  token: string,
  now: number = Date.now()
): void {
  const key = keyFor(token);
  checkedAtByToken.delete(key);
  checkedAtByToken.set(key, now);
  for (const oldest of checkedAtByToken.keys()) {
    if (checkedAtByToken.size <= MAX_TRACKED_TOKENS) break;
    checkedAtByToken.delete(oldest);
  }
}

// At most one warning every five minutes: during a store outage this runs for
// every answer.
function warnSharedStoreTrouble(operation: 'read' | 'write', now: number) {
  if (now - lastSharedStoreWarningAt < SHARED_STORE_WARNING_INTERVAL_MS) return;
  lastSharedStoreWarningAt = now;
  logger.warn({
    message:
      'Quiz session-check store did not answer; asking Supabase Auth instead',
    operation,
  });
}

/**
 * True when Supabase Auth confirmed this token's session within the time
 * limit, on this instance or on any other through the shared store.
 */
export async function wasSessionCheckedRecently(
  token: string,
  now: number = Date.now()
): Promise<boolean> {
  if (hasRecentSessionCheck(token, now)) return true;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const stored = await withinDeadline(
      redis.get<number>(`${SHARED_KEY_PREFIX}${keyFor(token)}`),
      SHARED_STORE_DEADLINE_MS
    );
    if (stored === DEADLINE_PASSED) {
      warnSharedStoreTrouble('read', now);
      return false;
    }
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return false;
    if (stored - now > MAX_CLOCK_SKEW_MS) return false;
    // Keep the time of the original check, never a later one, so the two
    // layers together cannot stretch the time limit.
    const checkedAt = Math.min(stored, now);
    if (now - checkedAt >= RECENT_SESSION_CHECK_TTL_MS) return false;
    recordSessionCheck(token, checkedAt);
    return true;
  } catch {
    warnSharedStoreTrouble('read', now);
    return false;
  }
}

/** Records a Supabase Auth confirmation here and in the shared store. */
export async function rememberSessionCheck(
  token: string,
  now: number = Date.now()
): Promise<void> {
  recordSessionCheck(token, now);
  const redis = getRedis();
  if (!redis) return;
  try {
    const outcome = await withinDeadline(
      redis.set(`${SHARED_KEY_PREFIX}${keyFor(token)}`, now, {
        px: RECENT_SESSION_CHECK_TTL_MS,
      }),
      SHARED_STORE_DEADLINE_MS
    );
    if (outcome === DEADLINE_PASSED) warnSharedStoreTrouble('write', now);
  } catch {
    warnSharedStoreTrouble('write', now);
  }
}

export function resetRecentSessionChecksForTesting(): void {
  checkedAtByToken.clear();
  lastSharedStoreWarningAt = Number.NEGATIVE_INFINITY;
}
