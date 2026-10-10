import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Release pre-staged tombstones after a confirmed upload failure.
 * Objects stage before their Storage write so termination never
 * leaks an orphan; when the write itself fails, its tombstone
 * would otherwise sweep a path nothing references. Only unclaimed
 * rows release — a fresh pre-stage is seconds old and can never be
 * claimed, so a claimed row means another flow owns it. Best
 * effort: a leftover tombstone merely reaps on schedule.
 */
export async function releaseBlogMediaPaths(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await supabase
      .from(BLOG_MEDIA_TOMBSTONE_TABLE)
      .delete()
      .in('path', paths)
      .eq('claimed', false);
    if (error) {
      console.error('Failed to release blog media tombstones', {
        error,
        paths,
      });
    }
  } catch (error) {
    console.error('Failed to release blog media tombstones', {
      error,
      paths,
    });
  }
}
