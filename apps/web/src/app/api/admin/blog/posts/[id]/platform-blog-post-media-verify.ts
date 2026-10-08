import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { blogPostMediaPaths } from '@/app/api/admin/blog/upload/blog-media-tombstone-clear';
import { verifyBlogMediaObjectsPresent } from '@/app/api/admin/blog/upload/blog-media-verify';
import type { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Verify a patched post's media survived the save, restoring the
 * pre-update fields when it did not. Clearing blocks on the sweep's
 * row locks while a claim is in flight, so this probe always sees
 * post-sweep metadata truth: a sweep that claimed between the update
 * and this probe leaves its paths missing, and the save restores the
 * previous row loudly instead of persisting broken media.
 */
export async function verifyPatchedBlogPostMediaOrRestore(
  supabase: ServerSupabaseClient,
  args: {
    existingPost: object;
    finalUpdateData: Record<string, unknown>;
    mediaRow: BlogPostMediaRow;
    postId: string;
  }
): Promise<{ ok: true } | { ok: false }> {
  const presence = await verifyBlogMediaObjectsPresent(
    supabase,
    blogPostMediaPaths(args.mediaRow)
  );
  if (presence !== null && presence.missing.length === 0) {
    return { ok: true };
  }
  if (presence !== null) {
    console.error('Patched platform blog post references swept media', {
      missing: presence.missing,
      postId: args.postId,
    });
  }
  const snapshot = args.existingPost as Record<string, unknown>;
  const restore: Record<string, unknown> = {};
  for (const key of Object.keys(args.finalUpdateData)) {
    if (key in snapshot) restore[key] = snapshot[key];
  }
  let restoreError: unknown = null;
  if (Object.keys(restore).length > 0) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { error } = await supabase
          .from('blog_posts')
          .update(restore)
          .eq('id', args.postId)
          .eq('is_platform_post', true)
          .is('merchant_id', null);
        if (!error) {
          restoreError = null;
          break;
        }
        restoreError = error;
      } catch (error) {
        restoreError = error;
      }
    }
  }
  if (restoreError !== null) {
    console.error('Failed to restore platform blog post media save', {
      error: restoreError,
      postId: args.postId,
    });
  }
  return { ok: false };
}
