import type { createClient } from '@/lib/supabase/server';
import { filterBlogMediaPathsWithoutPersistedReferences } from './blog-media-reference-scan';
import {
  BLOG_MEDIA_TOMBSTONE_GRACE_MS,
  BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT,
  BLOG_MEDIA_TOMBSTONE_TABLE,
} from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type TombstoneRow = { path: string };

/**
 * Remove staged deletions whose grace window expired and no persisted
 * post references. Tombstones referenced again (a concurrent save
 * resurrected them, or missed resurrection but committed anyway) are
 * cleared and their objects kept. Staging is rechecked after the
 * scan so a save committing between scan and removal invalidates the
 * sweep instead of losing the race. Returns null when the sweep
 * cannot verify safety so the scheduler retries instead of deleting
 * blind.
 */
export async function sweepDueBlogMediaTombstones(
  supabase: ServerSupabaseClient,
  now: Date = new Date()
): Promise<{ swept: string[]; resurrected: string[] } | null> {
  const cutoff = new Date(
    now.getTime() - BLOG_MEDIA_TOMBSTONE_GRACE_MS
  ).toISOString();
  let tombstones: {
    data: TombstoneRow[] | null;
    error: { message: string } | null;
  };
  try {
    const result = await supabase
      .from(BLOG_MEDIA_TOMBSTONE_TABLE)
      .select('path')
      .lt('created_at', cutoff)
      .order('created_at')
      .limit(BLOG_MEDIA_TOMBSTONE_SWEEP_LIMIT);
    tombstones = {
      data: result.data as TombstoneRow[] | null,
      error: result.error as { message: string } | null,
    };
  } catch {
    return null;
  }
  if (tombstones.error) return null;
  const rows = tombstones.data ?? [];
  if (rows.length === 0) return { swept: [], resurrected: [] };
  const paths = rows.map((row) => row.path);
  const filtered = await filterBlogMediaPathsWithoutPersistedReferences(
    supabase,
    paths
  );
  if (filtered === null) return null;
  const { deletable, skipped } = filtered;
  // Recheck staging before removal: a save may have committed and
  // cleared tombstones since the scan, and only rows still present
  // are safe to remove.
  let removable = deletable;
  let invalidated: string[] = [];
  if (deletable.length > 0) {
    let staged: {
      data: TombstoneRow[] | null;
      error: { message: string } | null;
    };
    try {
      const result = await supabase
        .from(BLOG_MEDIA_TOMBSTONE_TABLE)
        .select('path')
        .in('path', deletable);
      staged = {
        data: result.data as TombstoneRow[] | null,
        error: result.error as { message: string } | null,
      };
    } catch {
      return null;
    }
    if (staged.error) return null;
    const stillStaged = new Set((staged.data ?? []).map((row) => row.path));
    removable = deletable.filter((path) => stillStaged.has(path));
    invalidated = deletable.filter((path) => !stillStaged.has(path));
  }
  if (removable.length > 0) {
    try {
      const { error } = await supabase.storage.from('media').remove(removable);
      if (error) {
        console.error('Blog media tombstone sweep removal failed', {
          error,
          paths: removable,
        });
        return null;
      }
    } catch (error) {
      console.error('Blog media tombstone sweep removal failed', {
        error,
        paths: removable,
      });
      return null;
    }
  }
  // Row cleanup is best-effort: lingering rows are rechecked next
  // sweep, and object removal above is idempotent. Invalidated rows
  // were already cleared by the concurrent save.
  const done = [...removable, ...skipped];
  if (done.length > 0) {
    try {
      const { error } = await supabase
        .from(BLOG_MEDIA_TOMBSTONE_TABLE)
        .delete()
        .in('path', done);
      if (error) {
        console.error('Blog media tombstone sweep row cleanup failed', {
          error,
          paths: done,
        });
      }
    } catch (error) {
      console.error('Blog media tombstone sweep row cleanup failed', {
        error,
        paths: done,
      });
    }
  }
  return { swept: removable, resurrected: [...skipped, ...invalidated] };
}
