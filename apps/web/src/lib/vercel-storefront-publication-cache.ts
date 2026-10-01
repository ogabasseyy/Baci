import 'server-only';

import { dangerouslyDeleteByTag, invalidateByTag } from '@vercel/functions';

// Vercel documents 16 tags per bulk REST purge. The runtime API shares the
// purge control plane but does not publish a separate bulk limit, so use the
// stricter documented bound and await every batch before moving outward.
const MAX_TAGS_PER_DELETE = 16;

type VercelStorefrontPublicationCacheResult =
  | {
      ok: true;
      reason:
        | 'deleted'
        | 'invalidated'
        | 'not_required'
        | 'not_running_on_vercel';
    }
  | { ok: false; reason: 'request_failed' };

interface VercelStorefrontPublicationCacheOptions {
  deleteByTag?: typeof dangerouslyDeleteByTag;
  invalidateByTag?: typeof invalidateByTag;
  isVercel?: boolean;
  mode?: 'delete' | 'invalidate';
}

/**
 * Delete tenant-scoped Data/Runtime/CDN cache tags in the foreground. Vercel's
 * tag purge spans all three cache types, so publication transitions are not
 * complete until every batch resolves.
 */
export async function purgeVercelStorefrontPublicationCache(
  tags: readonly string[],
  options: VercelStorefrontPublicationCacheOptions = {}
): Promise<VercelStorefrontPublicationCacheResult> {
  const uniqueTags = Array.from(
    new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  );
  if (uniqueTags.length === 0) {
    return { ok: true, reason: 'not_required' };
  }

  const isVercel = options.isVercel ?? process.env.VERCEL === '1';
  if (!isVercel) {
    return { ok: true, reason: 'not_running_on_vercel' };
  }

  try {
    const mode = options.mode ?? 'delete';
    const deleteByTag = options.deleteByTag ?? dangerouslyDeleteByTag;
    const invalidate = options.invalidateByTag ?? invalidateByTag;
    for (
      let index = 0;
      index < uniqueTags.length;
      index += MAX_TAGS_PER_DELETE
    ) {
      const batch = uniqueTags.slice(index, index + MAX_TAGS_PER_DELETE);
      if (mode === 'delete') {
        await deleteByTag(batch, { revalidationDeadlineSeconds: 0 });
      } else {
        await invalidate(batch);
      }
    }
    return { ok: true, reason: mode === 'delete' ? 'deleted' : 'invalidated' };
  } catch (error) {
    console.error('Vercel storefront publication cache operation failed', {
      error,
      mode: options.mode ?? 'delete',
      tags: uniqueTags,
    });
    return { ok: false, reason: 'request_failed' };
  }
}
