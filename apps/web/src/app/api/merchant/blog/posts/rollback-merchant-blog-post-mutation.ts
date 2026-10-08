import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { stableStringify } from '@/lib/stable-stringify';

type RollbackClient = Pick<SupabaseClient, 'from'>;

type RollbackCommon = {
  merchantId: string;
  postId: string;
  savedMedia: BlogPostMediaRow;
  supabase: RollbackClient;
};

export type MerchantMutationRollback =
  | (RollbackCommon & { existingPost: object; mode: 'update' })
  | (RollbackCommon & { mode: 'create' });

export type MerchantRollbackOutcome = 'deleted' | 'restored' | 'skipped';

const ROLLBACK_MEDIA_KEYS = [
  'content',
  'excerpt',
  'featured_image_url',
  'featured_image_variants',
  'author_image_url',
] as const;

const ROLLBACK_GUARD_COLUMNS = ['updated_at', ...ROLLBACK_MEDIA_KEYS].join(
  ', '
);

/**
 * Compensate a merchant save whose media the sweep took mid-save.
 * Creates delete the broken row; updates restore the pre-save media
 * fields. Both re-read the row first and skip when another tab's
 * content stands: restoring or deleting over it would destroy work
 * that re-verified after this save. The atomic RPC swallows the
 * commit timestamp, so the guard compares the re-read media against
 * the saved payload and version-pins the write to the re-read
 * timestamp instead of the unreachable commit timestamp.
 */
export async function rollbackMerchantBlogPostMutation(
  args: MerchantMutationRollback
): Promise<MerchantRollbackOutcome> {
  let rollbackError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data: current, error: readError } = await args.supabase
        .from('blog_posts')
        .select(ROLLBACK_GUARD_COLUMNS)
        .eq('id', args.postId)
        .eq('merchant_id', args.merchantId)
        .single();
      if (readError || !current) {
        return 'skipped';
      }
      const currentRow = current as unknown as Record<string, unknown>;
      const intervened = ROLLBACK_MEDIA_KEYS.some(
        (key) =>
          stableStringify(currentRow[key]) !==
          stableStringify(args.savedMedia[key])
      );
      if (intervened || typeof currentRow.updated_at !== 'string') {
        return 'skipped';
      }
      if (args.mode === 'create') {
        const { data: deleted, error } = await args.supabase
          .from('blog_posts')
          .delete()
          .eq('id', args.postId)
          .eq('merchant_id', args.merchantId)
          .eq('updated_at', currentRow.updated_at)
          .select('id');
        if (!error && (deleted?.length ?? 0) > 0) {
          return 'deleted';
        }
        rollbackError = error ?? new Error('delete affected no rows');
        continue;
      }
      const snapshot = args.existingPost as Record<string, unknown>;
      const restore: Record<string, unknown> = {};
      for (const key of ROLLBACK_MEDIA_KEYS) {
        if (key in snapshot) restore[key] = snapshot[key];
      }
      if (Object.keys(restore).length === 0) {
        return 'skipped';
      }
      const { data: restored, error } = await args.supabase
        .from('blog_posts')
        .update(restore)
        .eq('id', args.postId)
        .eq('merchant_id', args.merchantId)
        .eq('updated_at', currentRow.updated_at)
        .select('id');
      if (!error && (restored?.length ?? 0) > 0) {
        return 'restored';
      }
      rollbackError = error ?? new Error('restore affected no rows');
    } catch (error) {
      rollbackError = error;
    }
  }
  console.error('Failed to roll back merchant blog post save', {
    error: rollbackError,
    postId: args.postId,
  });
  return 'skipped';
}
