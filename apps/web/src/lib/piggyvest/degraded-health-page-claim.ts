import 'server-only';
import { getRedis } from '@/lib/redis';

/**
 * The page limit is rolling, not a fixed hour bucket: at most one page per
 * reason in any 59 minutes, so two pages never land minutes apart across a
 * bucket boundary.
 */
const SHARED_CLAIM_TTL_SECONDS = 3_540;
/**
 * This copy's own memory of its last page per reason. Shorter than the
 * shared claim so a top-of-hour run a few minutes early is not blocked.
 */
const LOCAL_MIN_GAP_MS = 50 * 60_000;

const MS_PER_HOUR = 3_600_000;
/**
 * Without a shared store, only the run scheduled for the top of the UTC hour
 * may page: one landing within 2.5 minutes either side of it. The single
 * scheduled caller (the VPS crontab) runs the check every 5 minutes, so
 * exactly one run is that close even when it fires a little early or late,
 * and eligible runs are about an hour apart: at most one page per reason per
 * hour even when every run lands on a fresh server copy (Vercel cold starts),
 * with no shared state. A second caller would add pages; that is what the
 * shared Redis claim is for.
 */
const FALLBACK_HALF_WINDOW_MS = 150_000;

function isTopOfHourRun(nowMs: number): boolean {
  const offset = ((nowMs % MS_PER_HOUR) + MS_PER_HOUR) % MS_PER_HOUR;
  return (
    offset < FALLBACK_HALF_WINDOW_MS ||
    offset >= MS_PER_HOUR - FALLBACK_HALF_WINDOW_MS
  );
}

const lastPagedAt = new Map<string, number>();

/** Claims a page across server copies; null when no shared store answers. */
export type SharedPageClaim = (reason: string) => Promise<boolean | null>;

/**
 * Upstash Redis SET NX with a 59-minute expiry per reason: the first server
 * copy to claim it pages, every other copy (cold starts, scale-out) sees it
 * taken until it expires. Null when Redis is not configured or fails, so the
 * caller falls back to the top-of-hour window and still pages rather than
 * going silent.
 */
export const claimSharedPage: SharedPageClaim = async (reason) => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const result = await redis.set(`piggyvest:degraded-page:${reason}`, '1', {
      nx: true,
      ex: SHARED_CLAIM_TTL_SECONDS,
    });
    return result === 'OK';
  } catch {
    return null;
  }
};

/**
 * At most one page per reason in any rolling hour: first this copy's own
 * last page, then the shared claim across copies when one answers, else only
 * from the top-of-hour window.
 */
export async function claimDegradedPage(
  reason: string,
  shared: SharedPageClaim = claimSharedPage,
  nowMs: number = Date.now()
): Promise<boolean> {
  const last = lastPagedAt.get(reason);
  if (last !== undefined && nowMs - last < LOCAL_MIN_GAP_MS) return false;
  // Held while asking, so a second call in this copy cannot page too.
  lastPagedAt.set(reason, nowMs);
  const sharedResult = await shared(reason);
  const allowed = sharedResult ?? isTopOfHourRun(nowMs);
  // Keep the mark only when this copy paged or another copy did; a run that
  // could not ask Redis and was outside the window tries again next run.
  if (!allowed && sharedResult === null) {
    if (last === undefined) lastPagedAt.delete(reason);
    else lastPagedAt.set(reason, last);
  }
  return allowed;
}

/** Test-only: forget which pages were already sent in this copy. */
export function resetDegradedPageClaims(): void {
  lastPagedAt.clear();
}
