import { createHash } from 'node:crypto';
import {
  oxygenBankListSchema,
  oxygenBankProviderListSchema,
} from '@/schemas/oxygen-bank-details';
import type { OxygenEnvironment } from './environment';

type Bank = { name: string; code: string };
type Cache = {
  get(key: string): Promise<unknown>;
  set(
    key: string,
    value: unknown,
    options?: { nx?: boolean; ex?: number }
  ): Promise<unknown>;
  del?(key: string): Promise<unknown>;
};
type Provider = {
  call(operation: 'banks', input: Record<string, unknown>): Promise<unknown>;
};
/** A cold cache is repopulated at most once per lock window. */
const REFRESH_LOCK_SECONDS = 60;

function key(environment: OxygenEnvironment, partner: string) {
  const digest = createHash('sha256').update(partner).digest('hex');
  return `oxygen:supported-banks:${environment}:${digest}:v1`;
}

function lockKey(environment: OxygenEnvironment, partner: string) {
  return `${key(environment, partner)}:refresh-lock`;
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

/**
 * Cache-first read for checkout. A cold cache (first deploy, eviction, or a new
 * partner reference) is repopulated by one caller; concurrent reads keep the
 * unavailable response instead of stampeding the provider.
 */
export async function readOrRefreshSupportedBanks(
  cache: Cache,
  environment: OxygenEnvironment,
  partner: string,
  providerSource: () => Provider | null
): Promise<Bank[] | null> {
  const cached = await readSupportedBanks(cache, environment, partner);
  if (cached) return cached;

  const lock = lockKey(environment, partner);
  const claimed = await cache.set(lock, 'refreshing', {
    nx: true,
    ex: REFRESH_LOCK_SECONDS,
  });
  if (!claimed) return null;

  try {
    const provider = providerSource();
    if (!provider) return null;
    return await refreshSupportedBanks(cache, provider, environment, partner);
  } catch {
    return null;
  } finally {
    try {
      await cache.del?.(lock);
    } catch {
      // The lock expires on its own; a failed release must not fail the read.
    }
  }
}
