import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogPostMediaRow } from '@/app/api/admin/blog/upload/blog-media-reference-scan';
import { blogPostMediaPaths } from '@/app/api/admin/blog/upload/blog-media-tombstone-clear';

type MerchantVerifyClient = Pick<SupabaseClient, 'rpc'>;

type ReferenceStatus = {
  path: string;
  status: string;
};

export type MerchantMediaVerifyResult =
  | { kind: 'ok' }
  | { kind: 'failed'; reason: 'registration-failed' | 'lost-media' };

/**
 * Tombstone handshake for a committed merchant save. Merchant rows share
 * the platform posts table, so the sweep scan sees committed merchant
 * references — but a save landing after the scan's snapshot and before
 * its storage removal still loses the race. Registering the saved
 * content's paths resurrects unclaimed tombstones inside the call
 * (which blocks on the sweep's row locks while a claim is in flight)
 * and reports claimed or missing paths the sweep already took, so the
 * save aborts loudly instead of persisting broken media.
 */
export async function verifyMerchantBlogPostMedia({
  supabase,
  mediaRow,
}: {
  supabase: MerchantVerifyClient;
  mediaRow: BlogPostMediaRow;
}): Promise<MerchantMediaVerifyResult> {
  const savedPaths = blogPostMediaPaths(mediaRow);
  if (savedPaths.length === 0) {
    return { kind: 'ok' };
  }
  const { data: statuses, error: registerError } = await supabase.rpc(
    'register_blog_media_references_v1',
    { p_paths: savedPaths }
  );
  if (registerError || !statuses) {
    return { kind: 'failed', reason: 'registration-failed' };
  }
  const lost = (statuses as ReferenceStatus[]).some(
    (entry) => entry.status !== 'cleared'
  );
  if (lost) {
    return { kind: 'failed', reason: 'lost-media' };
  }
  return { kind: 'ok' };
}
