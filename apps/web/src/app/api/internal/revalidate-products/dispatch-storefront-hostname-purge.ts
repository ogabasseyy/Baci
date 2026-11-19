import {
  purgeStorefrontHostnameConfirmed,
  scheduleStorefrontHostnamePurge,
} from '@/lib/storefront-product-purge-hostnames';

/**
 * Dispatches either a confirmed or fire-and-forget Cloudflare hostname purge
 * for an internal product revalidation request.
 */
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
