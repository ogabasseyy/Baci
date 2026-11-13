import 'server-only';
import { getRedis } from '@/lib/redis';

const CLAIM_CAPACITY = 64;
/** A little over an hour, so the claim outlives its UTC-hour bucket. */
const SHARED_CLAIM_TTL_SECONDS = 3_700;

const MS_PER_HOUR = 3_600_000;
/**
 * Without a shared store, only the run scheduled for the top of the UTC hour
 * may page: one landing within 2.5 minutes either side of it. The single
 * scheduled caller (the VPS crontab) runs the check every 5 minutes, so
 * exactly one run is that close even when it fires a little early or late:
 * at most one page per reason per hour even when every run lands on a fresh
 * server copy (Vercel cold starts), with no shared state. A second caller
 * would add pages; that is what the shared Redis claim is for.
 */
const FALLBACK_HALF_WINDOW_MS = 150_000;

function isTopOfHourRun(nowMs: number): boolean {
  const offset = ((nowMs % MS_PER_HOUR) + MS_PER_HOUR) % MS_PER_HOUR;
  return (
    offset < FALLBACK_HALF_WINDOW_MS ||
    offset >= MS_PER_HOUR - FALLBACK_HALF_WINDOW_MS
  );
}

const claimedPages = new Set<string>();

/** Claims a page across server copies; null when no shared store answers. */
export type SharedPageClaim = (key: string) => Promise<boolean | null>;

/**
 * Upstash Redis SET NX with expiry: the first server copy to claim a
 * reason+hour pages, every other copy (cold starts, scale-out) sees it taken.
 * Null when Redis is not configured or fails, so the caller falls back to the
 * hour's first-run window and still pages rather than going silent.
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
 * across copies through the shared claim when one is available, else only
 * from the hour's first-run window.
 */
export async function claimDegradedPage(
  reason: string,
  hour: number,
  shared: SharedPageClaim = claimSharedPage,
  nowMs: number = Date.now()
): Promise<boolean> {
  const key = `${reason}:${hour}`;
  if (claimedPages.has(key)) return false;
  claimedPages.add(key);
  if (claimedPages.size > CLAIM_CAPACITY) {
    const oldest = claimedPages.values().next().value;
    if (oldest !== undefined) claimedPages.delete(oldest);
  }
  const sharedResult = await shared(key);
  const allowed = sharedResult ?? isTopOfHourRun(nowMs);
  // Keep this copy's claim only when it paged or another copy did; a run
  // that could not ask Redis and was outside the window tries again next run.
  if (!allowed && sharedResult === null) claimedPages.delete(key);
  return allowed;
}

/** Test-only: forget which pages were already sent in this copy. */
export function resetDegradedPageClaims(): void {
  claimedPages.clear();
}
