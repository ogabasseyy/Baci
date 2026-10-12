import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Stage candidate delete paths as tombstones instead of removing
 * them. A concurrent save can resurrect a tombstone its payload
 * references before the sweep's grace window expires, closing the
 * race between the reference scan and another tab's INSERT. Returns
 * false when staging fails so the route fails closed instead of
 * deleting blind. Re-staging keeps the original timestamp so the
 * first abandonment starts the grace window.
 */
export async function tombstoneBlogMediaPaths(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const { error } = await supabase.from(BLOG_MEDIA_TOMBSTONE_TABLE).upsert(
      paths.map((path) => ({ path })),
      { ignoreDuplicates: true, onConflict: 'path' }
    );
    return error === null;
  } catch {
    return false;
  }
}
