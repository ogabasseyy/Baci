import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type TombstoneRow = { path: string };

export type BlogMediaPresence = { missing: string[] };

/**
 * Verify referenced media objects survived the save, AFTER clearing
 * tombstones. Clearing blocks on the sweep's row locks while a claim
 * is in flight, so this probe always sees post-sweep truth. A path is
 * missing when the sweep already claimed it (its flag is set and the
 * API removal is imminent or done) or when its object metadata is
 * gone; either way the save must roll back loudly instead of
 * persisting broken media. Returns null when presence itself is
 * unverifiable so the save fails closed.
 */
export async function verifyBlogMediaObjectsPresent(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<BlogMediaPresence | null> {
  if (paths.length === 0) return { missing: [] };
  try {
    const flagged = await supabase
      .from(BLOG_MEDIA_TOMBSTONE_TABLE)
      .select('path')
      .eq('claimed', true)
      .in('path', paths);
    if (flagged.error) return null;
    const { data, error } = await supabase.rpc(
      'blog_media_objects_present_v1',
      { p_paths: paths }
    );
    if (error) return null;
    const present = new Set(
      ((data ?? []) as { path: string }[]).map((row) => row.path)
    );
    const claimed = new Set(
      ((flagged.data ?? []) as TombstoneRow[]).map((row) => row.path)
    );
    return {
      missing: paths.filter((path) => claimed.has(path) || !present.has(path)),
    };
  } catch {
    return null;
  }
}
