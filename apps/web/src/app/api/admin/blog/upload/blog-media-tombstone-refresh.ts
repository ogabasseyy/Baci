import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Extend the sweep grace window for staged uploads an open draft
 * still references. Uploads stage as tombstones immediately so an
 * abandoned session still sweeps, but an active editor session can
 * stay open past the grace window: its heartbeat calls this while
 * the draft is unsaved. Claimed rows are already selected for
 * removal and never refresh. Returns false when the refresh fails
 * so the route reports it instead of pretending the lease moved.
 */
export async function refreshBlogMediaTombstones(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const { error } = await supabase
      .from(BLOG_MEDIA_TOMBSTONE_TABLE)
      .update({ created_at: new Date().toISOString() })
      .in('path', paths)
      .eq('claimed', false);
    return error === null;
  } catch {
    return false;
  }
}
