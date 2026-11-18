import { revalidateTag } from 'next/cache';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';

/**
 * Revalidate the cached category surfaces for a merchant.
 *
 * Lives in its own module, separate from `cache-revalidation.ts`, because that
 * module imports `cloudflare-purge` — which reads `getCloudflareApiToken` and
 * therefore counts as a credential-authority reach. Any NEW API route importing
 * it inherits that reach and fails the event-pipeline boundary gate
 * (`verify-event-pipeline-boundaries.live.test.ts`). This function needs only
 * `revalidateTag`, so the category routes import it directly and stay clean.
 * `cache-revalidation.ts` re-exports it, so existing callers are unaffected.
 */
export function revalidateCategories(
  merchantId: string,
  categorySlug?: string,
  options: { expireImmediately?: boolean } = {}
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) {
    console.warn(
      '[revalidateCategories] Skipped category cache revalidation for invalid merchant ID'
    );
    return;
  }

  const profile = options.expireImmediately
    ? ({ expire: 0 } as const)
    : 'categories';
  const storefrontProfile = options.expireImmediately
    ? ({ expire: 0 } as const)
    : 'storefront-page';
  const productProfile = options.expireImmediately
    ? ({ expire: 0 } as const)
    : 'products';

  revalidateTag(`categories-${normalizedMerchantId}`, profile);
  revalidateTag(`navigation-categories-${normalizedMerchantId}`, profile);
  revalidateTag(
    getCategoryPageDataCacheTag(normalizedMerchantId),
    storefrontProfile
  );
  revalidateTag(
    `product-canonical-redirect-${normalizedMerchantId}`,
    productProfile
  );
  revalidateTag(
    `product-legacy-redirect-${normalizedMerchantId}`,
    productProfile
  );

  if (categorySlug) {
    revalidateTag(`category-${normalizedMerchantId}-${categorySlug}`, profile);
  }
}
