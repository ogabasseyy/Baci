import {
  purgeStorefrontProductConfirmed,
  scheduleStorefrontProductPurge,
} from '@/lib/storefront-product-purge';
import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import { dispatchStorefrontHostnamePurge } from './dispatch-storefront-hostname-purge';

/**
 * Dispatches either a confirmed or fire-and-forget Cloudflare product purge,
 * escalating to a hostname purge when blog-post slug lookup is incomplete.
 */
export async function dispatchStorefrontProductPurge({
  merchantSlug,
  entries,
  blogPostSlugs,
  blogPostSlugsIncomplete,
  confirmEdgeEviction,
}: {
  merchantSlug: string;
  entries: readonly StorefrontProductPurgeEntry[];
  blogPostSlugs: readonly string[];
  blogPostSlugsIncomplete: boolean;
  confirmEdgeEviction: boolean;
}): Promise<boolean> {
  if (blogPostSlugsIncomplete) {
    return await dispatchStorefrontHostnamePurge(
      merchantSlug,
      confirmEdgeEviction
    );
  }
  if (confirmEdgeEviction) {
    return blogPostSlugs.length > 0
      ? await purgeStorefrontProductConfirmed(merchantSlug, entries, {
          blogPostSlugs,
        })
      : await purgeStorefrontProductConfirmed(merchantSlug, entries);
  }
  if (blogPostSlugs.length > 0) {
    scheduleStorefrontProductPurge(merchantSlug, entries, { blogPostSlugs });
  } else {
    scheduleStorefrontProductPurge(merchantSlug, entries);
  }
  return false;
}
