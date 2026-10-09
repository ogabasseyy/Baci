import {
  BLOG_MEDIA_TOMBSTONE_GRACE_MS,
  BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT,
} from './blog-media-tombstone-constants';

export type BlogMediaSweepClient = {
  rpc: (
    functionName: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from: (bucket: string) => {
      remove: (
        paths: string[]
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type ClaimRow = { tombstone_claimed: boolean; tombstone_path: string };

/**
 * Remove staged deletions whose grace window expired and no persisted
 * post references. The claim runs in one transaction (row locks, a
 * reference re-scan under the same snapshot, and an atomic claimed
 * flag), so a save committing between the sweep's read and its removal
 * cannot lose the race: the save's clear blocks on the claim's locks
 * and its post-insert verification sees claimed flags or missing
 * metadata. The Storage API performs the actual deletion (direct SQL
 * deletes would orphan file bytes); claimed rows persist until the API
 * removal succeeds, so a failed sweep simply retries its bytes on the
 * next run. The caller supplies the least-privilege sweep worker
 * capability — never a service-role client — so row cleanup goes
 * through the release wrapper instead of direct table access. Returns
 * null when the sweep cannot verify safety so the scheduler retries
 * instead of deleting blind.
 */
export async function sweepDueBlogMediaTombstones(
  supabase: BlogMediaSweepClient,
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
  try {
    const { error } = await supabase.storage.from('media').remove(swept);
    if (error) {
      console.error('Blog media tombstone sweep removal failed', {
        error,
        paths: swept,
      });
      return null;
    }
  } catch (error) {
    console.error('Blog media tombstone sweep removal failed', {
      error,
      paths: swept,
    });
    return null;
  }
  // Row cleanup is best-effort: lingering claimed rows are rechecked
  // next sweep, and object removal above is idempotent. The release
  // wrapper revalidates the platform prefix and the claimed flag, so
  // a compromised sweep input cannot drop arbitrary tombstone rows.
  try {
    const { error } = await supabase.rpc(
      'delete_claimed_blog_media_tombstones',
      { p_paths: swept }
    );
    if (error) {
      console.error('Blog media tombstone sweep row cleanup failed', {
        error,
        paths: swept,
      });
    }
  } catch (error) {
    console.error('Blog media tombstone sweep row cleanup failed', {
      error,
      paths: swept,
    });
  }
  return { swept, resurrected };
}
