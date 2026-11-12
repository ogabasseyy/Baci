import 'server-only';
import { getRedis } from '@/lib/redis';

const CLAIM_CAPACITY = 64;
/** A little over an hour, so the claim outlives its UTC-hour bucket. */
const SHARED_CLAIM_TTL_SECONDS = 3_700;

const claimedPages = new Set<string>();

/** Claims a page across server copies; null when no shared store answers. */
export type SharedPageClaim = (key: string) => Promise<boolean | null>;

/**
 * Upstash Redis SET NX with expiry: the first server copy to claim a
 * reason+hour pages, every other copy (cold starts, scale-out) sees it taken.
 * Null when Redis is not configured or fails, so the caller falls back to the
 * in-process claim and still pages rather than going silent.
 */
export const claimSharedPage: SharedPageClaim = async (key) => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const result = await redis.set(`piggyvest:degraded-page:${key}`, '1', {
      nx: true,
      ex: SHARED_CLAIM_TTL_SECONDS,
    });
    return result === 'OK';
  } catch {
    return null;
  }
};

/**
 * One page per reason per UTC hour: first within this server copy, then
 * across copies through the shared claim when one is available.
 */
export async function claimDegradedPage(
  reason: string,
  hour: number,
  shared: SharedPageClaim = claimSharedPage
): Promise<boolean> {
  const key = `${reason}:${hour}`;
  if (claimedPages.has(key)) return false;
  claimedPages.add(key);
  if (claimedPages.size > CLAIM_CAPACITY) {
    const oldest = claimedPages.values().next().value;
    if (oldest !== undefined) claimedPages.delete(oldest);
  }
  const sharedResult = await shared(key);
  return sharedResult !== false;
}

/** Test-only: forget which pages were already sent in this copy. */
export function resetDegradedPageClaims(): void {
  claimedPages.clear();
}
