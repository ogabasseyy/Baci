import { createHash, randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import {
  oxygenBankListSchema,
  oxygenBankProviderListSchema,
} from '@/schemas/oxygen-bank-details';
import type { OxygenEnvironment } from './environment';
import { bankRefreshLockKey } from './supported-bank-refresh-lock';

type Bank = { name: string; code: string };
type Cache = {
  get(key: string): Promise<unknown>;
  set(
    key: string,
    value: unknown,
    options?: { nx?: boolean; ex?: number }
  ): Promise<unknown>;
};
/** The refresh lock is released with an atomic compare-and-delete script. */
type LockCache = Cache & {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};
type Provider = {
  call(operation: 'banks', input: Record<string, unknown>): Promise<unknown>;
};
/**
 * The lock is shared with the scheduled recovery job, so a cold cache is
 * repopulated by one refresher per lock window. After a failed refresh the
 * lock is kept, so the same window is the failure cooldown.
 */
const REFRESH_LOCK_SECONDS = 60;
const RELEASE_LOCK_IF_OWNED_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function key(environment: OxygenEnvironment, partner: string) {
  const digest = createHash('sha256').update(partner).digest('hex');
  return `oxygen:supported-banks:${environment}:${digest}:v1`;
}

export async function readSupportedBanks(
  cache: Cache,
  environment: OxygenEnvironment,
  partner: string
): Promise<Bank[] | null> {
  const parsed = oxygenBankListSchema.safeParse(
    await cache.get(key(environment, partner))
  );
  return parsed.success ? parsed.data.banks : null;
}

/** Never replace the last good cache entry on a failed or malformed refresh. */
export async function refreshSupportedBanks(
  cache: Cache,
  provider: Provider,
  environment: OxygenEnvironment,
  partner: string
): Promise<Bank[]> {
  const result = oxygenBankProviderListSchema.parse(
    await provider.call('banks', {})
  );
  const banks = oxygenBankListSchema.parse({
    banks: result.Result.map(({ Name, SortCode }) => ({
      name: Name,
      code: SortCode,
    })),
  }).banks;
  await cache.set(key(environment, partner), { banks });
  return banks;
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
  if (!claimed) return null;

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
    // not retried by every checkout miss. Log the class only, never the
    // provider response or message.
    refreshFailed = true;
    logger.error({
      message: 'Oxygen supported-bank refresh failed',
      environment,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  } finally {
    if (!refreshFailed) await releaseRefreshLock(cache, lock, token);
  }
}
