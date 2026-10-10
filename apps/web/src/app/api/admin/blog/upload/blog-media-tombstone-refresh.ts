import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Extend the sweep grace window for staged uploads an open draft
 * still references. Uploads stage as tombstones immediately so an
 * abandoned session still sweeps, but an active editor session can
 * stay open past the grace window: its heartbeat calls this while
 * the draft is unsaved. Claimed rows are already selected for
 * removal and never refresh. Every requested path must come back
 * refreshed: RLS can silently drop rows the caller may not update,
 * and a silent partial refresh would let the sweep delete media
 * from an active draft. Returns false when the refresh fails so
 * the route reports it instead of pretending the lease moved.
 */
export async function refreshBlogMediaTombstones(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const { data, error } = await supabase
      .from(BLOG_MEDIA_TOMBSTONE_TABLE)
      .update({ created_at: new Date().toISOString() })
      .in('path', paths)
      .eq('claimed', false)
      .select('path');
    if (error !== null) return false;
    const refreshed = new Set((data ?? []).map((row) => row.path));
    return paths.every((path) => refreshed.has(path));
  } catch {
    return false;
  }
}
