import {
  purgeStorefrontProductConfirmed,
  scheduleStorefrontProductPurge,
} from '@/lib/storefront-product-purge';
import {
  purgeStorefrontHostnameConfirmed,
  scheduleStorefrontHostnamePurge,
} from '@/lib/storefront-product-purge-hostnames';
import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';

export async function dispatchStorefrontHostnamePurge(
  merchantSlug: string,
  confirmEdgeEviction: boolean
): Promise<boolean> {
  if (confirmEdgeEviction) {
    return await purgeStorefrontHostnameConfirmed(merchantSlug);
  }
  scheduleStorefrontHostnamePurge(merchantSlug);
  return false;
}

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
