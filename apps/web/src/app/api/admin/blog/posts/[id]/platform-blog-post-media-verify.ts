import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { blogPostMediaPaths } from '@/app/api/admin/blog/upload/blog-media-tombstone-clear';
import { verifyBlogMediaObjectsPresent } from '@/app/api/admin/blog/upload/blog-media-verify';
import { stableStringify } from '@/lib/stable-stringify';
import type { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Verify a patched post's media survived the save, restoring the
 * pre-update fields when it did not. Clearing blocks on the sweep's
 * row locks while a claim is in flight, so this probe always sees
 * post-sweep metadata truth: a sweep that claimed between the update
 * and this probe leaves its paths missing, and the save restores the
 * previous row loudly instead of persisting broken media. The restore
 * is version-guarded: when another tab saved the post after this
 * update, its content already re-verified, so restoring would
 * resurrect broken media over a valid post and is skipped.
 */
export async function verifyPatchedBlogPostMediaOrRestore(
  supabase: ServerSupabaseClient,
  args: {
    expectedUpdatedAt: string | null;
    existingPost: object;
    finalUpdateData: Record<string, unknown>;
    mediaRow: BlogPostMediaRow;
    postId: string;
  }
): Promise<{ ok: true } | { ok: false; restored: boolean }> {
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
  if (Object.keys(restore).length === 0) {
    return { ok: false, restored: false };
  }
  // Guard columns: every field this update wrote, plus the write
  // timestamp the database assigned to it.
  const guardColumns = ['updated_at', ...Object.keys(args.finalUpdateData)];
  let restoreError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data: current, error: readError } = await supabase
        .from('blog_posts')
        .select(guardColumns.join(', '))
        .eq('id', args.postId)
        .eq('is_platform_post', true)
        .is('merchant_id', null)
        .single();
      if (readError || !current) {
        restoreError = readError ?? new Error('restore pre-read found no row');
        continue;
      }
      const currentRow = current as unknown as Record<string, unknown>;
      const intervened = Object.entries(args.finalUpdateData).some(
        ([key, value]) =>
          stableStringify(currentRow[key]) !== stableStringify(value)
      );
      if (
        intervened ||
        (args.expectedUpdatedAt !== null &&
          currentRow.updated_at !== args.expectedUpdatedAt)
      ) {
        // Another tab re-verified and committed newer content; leave it.
        return { ok: false, restored: false };
      }
      let guarded = supabase
        .from('blog_posts')
        .update(restore)
        .eq('id', args.postId)
        .eq('is_platform_post', true)
        .is('merchant_id', null);
      if (args.expectedUpdatedAt !== null) {
        guarded = guarded.eq('updated_at', args.expectedUpdatedAt);
      }
      const { data: restored, error } = await guarded.select('id');
      if (!error && (restored?.length ?? 0) > 0) {
        return { ok: false, restored: true };
      }
      restoreError = error ?? new Error('restore affected no rows');
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError !== null) {
    console.error('Failed to restore platform blog post media save', {
      error: restoreError,
      postId: args.postId,
    });
  }
  return { ok: false, restored: false };
}
