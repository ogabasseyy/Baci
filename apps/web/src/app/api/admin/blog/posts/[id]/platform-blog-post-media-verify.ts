import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { blogPostMediaPaths } from '@/app/api/admin/blog/upload/blog-media-tombstone-clear';
import { verifyBlogMediaObjectsPresent } from '@/app/api/admin/blog/upload/blog-media-verify';
import { stableStringify } from '@/lib/stable-stringify';
import type { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Columns whose values can reference sweepable media. Only an update
// that writes one of these can break media, so only such updates
// verify: a tab that changes a title while another tab's media is
// mid-sweep must neither fail nor restore — the media writer owns
// both. Restore likewise covers media keys only, guarded by those
// keys being untouched since this write: an intervening non-media
// update moves updated_at without invalidating a media restore,
// while an intervening media rewrite (re-verified by its own writer)
// blocks it.
const MEDIA_KEYS = [
  'author_image_url',
  'content',
  'excerpt',
  'featured_image_url',
  'featured_image_variants',
] as const;

/**
 * Verify a patched post's media survived the save, restoring the
 * pre-update media fields when it did not. Clearing blocks on the
 * sweep's row locks while a claim is in flight, so this probe always
 * sees post-sweep metadata truth: a sweep that claimed between the
 * update and this probe leaves its paths missing, and the save
 * restores the previous media loudly instead of persisting broken
 * references. The restore is key-guarded: when another tab rewrote
 * the same media keys after this update, its content already
 * re-verified, so restoring would resurrect broken media over a
 * valid post and is skipped. Non-media updates skip verification
 * entirely — they cannot break what they did not write, and failing
 * them on another tab's media would 500 a valid save.
 */
export async function verifyPatchedBlogPostMediaOrRestore(
  supabase: ServerSupabaseClient,
  args: {
    existingPost: object;
    finalUpdateData: Record<string, unknown>;
    mediaRow: BlogPostMediaRow;
    postId: string;
  }
): Promise<{ ok: true } | { ok: false; restored: boolean }> {
  // Only defined values count as written: undefined entries never
  // reach the row, so they guard and restore nothing.
  const writtenMediaKeys = (
    Object.keys(args.finalUpdateData) as string[]
  ).filter(
    (key) =>
      (MEDIA_KEYS as readonly string[]).includes(key) &&
      args.finalUpdateData[key] !== undefined
  );
  if (writtenMediaKeys.length === 0) {
    return { ok: true };
  }
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
  for (const key of writtenMediaKeys) {
    if (key in snapshot) restore[key] = snapshot[key];
  }
  if (Object.keys(restore).length === 0) {
    return { ok: false, restored: false };
  }
  // Guard columns: the media keys this update wrote. Both the
  // skip decision and the restore write match on these — never on
  // updated_at, which any intervening write moves, media or not.
  const guardColumns = [...writtenMediaKeys];
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
      const intervened = writtenMediaKeys.some(
        (key) =>
          stableStringify(currentRow[key]) !==
          stableStringify(args.finalUpdateData[key])
      );
      if (intervened) {
        // Another tab re-verified and committed newer media; leave it.
        return { ok: false, restored: false };
      }
      // Optimistic concurrency scoped to the media keys: the write
      // lands only if nobody rewrote them since the pre-read, so a
      // concurrent same-key write wins the race instead of being
      // clobbered. Objects serialize to JSON text (PostgREST casts
      // the filter value to jsonb for order-insensitive equality);
      // cleared fields match null explicitly.
      let guarded = supabase
        .from('blog_posts')
        .update(restore)
        .eq('id', args.postId)
        .eq('is_platform_post', true)
        .is('merchant_id', null);
      for (const key of writtenMediaKeys) {
        const value = args.finalUpdateData[key];
        if (value === null) {
          guarded = guarded.is(key, null);
        } else if (typeof value === 'object') {
          guarded = guarded.eq(key, stableStringify(value));
        } else {
          guarded = guarded.eq(key, value as string);
        }
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
