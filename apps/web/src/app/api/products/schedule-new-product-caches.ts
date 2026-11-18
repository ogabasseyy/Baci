import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { scheduleProductImageTransformsPrewarm } from '@/lib/schedule-product-image-prewarm';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import { resolveProductPurgeCategorySegment } from '@/lib/storefront-product-purge-urls';

interface ScheduleNewProductCachesArgs {
  merchantId: string;
  merchantSlug: string | undefined;
  productId: string;
  slug: string;
  name: string;
  category: string | null | undefined;
  images: Record<string, unknown>[];
  blogPostSlugs?: readonly string[];
}

export function scheduleNewProductCaches({
  merchantId,
  merchantSlug,
  productId,
  slug,
  name,
  category,
  images,
  blogPostSlugs = [],
}: ScheduleNewProductCachesArgs) {
  const trimmedSlug = slug.trim();
  const purgeSlug = trimmedSlug || productId.trim();
  const slugInvalidated = purgeSlug
    ? revalidateProductSlugs(merchantId, [purgeSlug], {
        expireImmediately: true,
      }) === true
    : false;
  const scopedExpired =
    revalidateProducts(merchantId, trimmedSlug || undefined, {
      expireImmediately: true,
      omitMerchantWidePdpDetails: slugInvalidated,
    }) !== false;
  const originExpired =
    scopedExpired ||
    (slugInvalidated &&
      revalidateProducts(merchantId, trimmedSlug || undefined, {
        expireImmediately: true,
      }) !== false);
  if (!originExpired) {
    console.warn(
      'Skipped Cloudflare product purge after create because origin expiry failed',
      { merchantId }
    );
    scheduleProductImageTransformsPrewarm(images);
    return;
  }
  try {
    const targetSlug = purgeSlug || productId;
    const purgeEntries = [
      {
        slug: targetSlug,
        categorySegment: resolveProductPurgeCategorySegment({
          slug: targetSlug,
          name,
          category,
        }),
      },
    ];
    if (blogPostSlugs.length > 0) {
      scheduleStorefrontProductPurge(merchantSlug, purgeEntries, {
        blogPostSlugs,
      });
    } else {
      scheduleStorefrontProductPurge(merchantSlug, purgeEntries);
    }
  } catch (purgeError) {
    console.warn('Skipped Cloudflare product purge after create', {
      purgeError,
    });
  }
  scheduleProductImageTransformsPrewarm(images);
}
