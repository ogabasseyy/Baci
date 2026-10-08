import type { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type BlogMediaPresence = { missing: string[] };

/**
 * Verify referenced media objects still exist AFTER clearing
 * tombstones. Clearing blocks on the sweep's row locks while a claim
 * is in flight, so this probe always sees post-sweep metadata truth:
 * a path the sweep claimed is missing here, and the save must roll
 * back loudly instead of persisting broken media. Returns null when
 * presence itself is unverifiable so the save fails closed.
 */
export async function verifyBlogMediaObjectsPresent(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<BlogMediaPresence | null> {
  if (paths.length === 0) return { missing: [] };
  try {
    const { data, error } = await supabase.rpc(
      'blog_media_objects_present_v1',
      { p_paths: paths }
    );
    if (error) return null;
    const present = new Set(
      ((data ?? []) as { path: string }[]).map((row) => row.path)
    );
    return { missing: paths.filter((path) => !present.has(path)) };
  } catch {
    return null;
  }
}
