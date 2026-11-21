import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import type { OxygenEnvironment } from './environment';
import {
  type Bank,
  type Cache,
  type Provider,
  readSupportedBanks,
  refreshSupportedBanks,
} from './supported-bank-cache';
import { bankRefreshLockKey } from './supported-bank-refresh-lock';

/** The refresh lock is released with an atomic compare-and-delete script. */
type LockCache = Cache & {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};
/**
 * The lock is shared with the scheduled recovery job, so a cold cache is
 * repopulated by one refresher per lock window. A cold refresh is a partner
 * login plus a bank request (30s timeout each), so the window leaves headroom
 * over that 60s worst case. After a failed refresh the lock is kept, and the
 * failure cooldown is intentionally this same 120s window.
 */
const REFRESH_LOCK_SECONDS = 120;
const RELEASE_LOCK_IF_OWNED_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const PROVIDER_OUTCOMES = new Set(['not_sent', 'rejected', 'indeterminate']);

/**
 * Triage fields for a failed refresh. Never the error message, the provider
 * response or the diagnostic: only the error class and, for a provider
 * failure, its fixed outcome (not_sent, rejected or indeterminate).
 */
function describeRefreshFailure(error: unknown) {
  if (!(error instanceof Error)) return { errorName: 'UnknownError' };
  const outcome = 'outcome' in error ? error.outcome : undefined;
  return {
    errorName: error.name,
    ...(typeof outcome === 'string' && PROVIDER_OUTCOMES.has(outcome)
      ? { outcome }
      : {}),
  };
}

/** Delete the lock only while it still holds our token, never a successor's. */
async function releaseRefreshLock(
  cache: LockCache,
  lock: string,
  token: string
): Promise<void> {
  try {
    await cache.eval(RELEASE_LOCK_IF_OWNED_SCRIPT, [lock], [token]);
  } catch {
    // The lock expires on its own; a failed release must not fail the read.
  }
}

/**
 * Cache-first read for checkout. A cold cache (first deploy, eviction, or a new
 * partner reference) is repopulated by one caller; concurrent reads keep the
 * unavailable response instead of stampeding the provider.
 */
export async function readOrRefreshSupportedBanks(
  cache: LockCache,
  environment: OxygenEnvironment,
  partner: string,
  providerSource: () => Provider | null
): Promise<Bank[] | null> {
  const cached = await readSupportedBanks(cache, environment, partner);
  if (cached) return cached;

  const lock = bankRefreshLockKey(environment, partner);
  // A per-claim token fences the release: a refresh that outlives the lock TTL
  // must not delete the lock a later request has since claimed.
  const token = randomUUID();
  const claimed = await cache.set(lock, token, {
    nx: true,
    ex: REFRESH_LOCK_SECONDS,
  });
  if (!claimed) {
    // The lock holder may have written the list since our first read; look
    // once more so a contended request is not told "unavailable" for nothing.
    return readSupportedBanks(cache, environment, partner);
  }

  let refreshFailed = false;
  try {
    // Another request may have populated the cache after our initial miss and
    // released the lock before we claimed it; recheck before calling Oxygen.
    const rechecked = await readSupportedBanks(cache, environment, partner);
    if (rechecked) return rechecked;

    const provider = providerSource();
    if (!provider) return null;
    return await refreshSupportedBanks(cache, provider, environment, partner);
  } catch (error) {
    // Keep the lock: its remaining TTL is the cooldown, so an Oxygen outage is
    // not retried by every checkout miss.
    refreshFailed = true;
    logger.error({
      message: 'Oxygen supported-bank refresh failed',
      environment,
      ...describeRefreshFailure(error),
    });
    return null;
  } finally {
    if (!refreshFailed) await releaseRefreshLock(cache, lock, token);
  }
}
