import type { createClient } from '@/lib/supabase/server';
import {
  BLOG_MEDIA_TOMBSTONE_GRACE_MS,
  BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT,
  BLOG_MEDIA_TOMBSTONE_TABLE,
} from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ClaimRow = { tombstone_claimed: boolean; tombstone_path: string };

/**
 * Remove staged deletions whose grace window expired and no persisted
 * post references. The claim runs in one transaction (row locks, a
 * reference re-scan under the same snapshot, and an atomic metadata
 * drop), so a save committing between the sweep's read and its removal
 * cannot lose the race: the save's clear blocks on the claim's locks
 * and its post-insert verification sees the final metadata state. The
 * storage removal below only reclaims file bytes for already-unservable
 * objects; a failure re-stages the paths so a later sweep retries the
 * bytes instead of leaking them. Returns null when the sweep cannot
 * verify safety so the scheduler retries instead of deleting blind.
 */
export async function sweepDueBlogMediaTombstones(
  supabase: ServerSupabaseClient,
  now: Date = new Date()
): Promise<{ swept: string[]; resurrected: string[] } | null> {
  const cutoff = new Date(
    now.getTime() - BLOG_MEDIA_TOMBSTONE_GRACE_MS
  ).toISOString();
  let claimed: ClaimRow[];
  try {
    const { data, error } = await supabase.rpc(
      'claim_sweepable_blog_media_tombstones',
      { p_cutoff: cutoff, p_limit: BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT }
    );
    if (error) return null;
    claimed = (data ?? []) as ClaimRow[];
  } catch {
    return null;
  }
  const swept = claimed
    .filter((row) => row.tombstone_claimed)
    .map((row) => row.tombstone_path);
  const resurrected = claimed
    .filter((row) => !row.tombstone_claimed)
    .map((row) => row.tombstone_path);
  if (swept.length === 0) return { swept, resurrected };
  let removalFailed: unknown = null;
  try {
    const { error } = await supabase.storage.from('media').remove(swept);
    if (error) removalFailed = error;
  } catch (error) {
    removalFailed = error;
  }
  if (removalFailed !== null) {
    console.error('Blog media tombstone sweep removal failed', {
      error: removalFailed,
      paths: swept,
    });
    try {
      await supabase.from(BLOG_MEDIA_TOMBSTONE_TABLE).upsert(
        swept.map((path) => ({ path })),
        { ignoreDuplicates: true, onConflict: 'path' }
      );
    } catch (restageError) {
      console.error('Blog media tombstone restage failed', {
        error: restageError,
        paths: swept,
      });
    }
    return null;
  }
  return { swept, resurrected };
}
