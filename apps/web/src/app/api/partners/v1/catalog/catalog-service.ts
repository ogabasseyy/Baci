import { cacheLife, cacheTag } from 'next/cache';
import { collectGoogleMerchantListings } from '@/app/api/feed/google-merchant/collect-google-merchant-listings';
import { getCachedGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { buildMerchantBaseUrl } from '@/app/api/feed/google-merchant/route-utils';
import { resolveFeedMerchant } from '@/lib/feed-identifier';
import { logger } from '@/lib/logger';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  CROSSREM_CATALOG_BINDINGS,
  CROSSREM_MERCHANT_ID,
} from './catalog-bindings';
import { projectCatalog } from './project-catalog';

export async function loadCrossRemCatalog() {
  'use cache';
  cacheLife('products');
  cacheTag(
    'google-merchant-feed',
    'products',
    `merchant-feed-${CROSSREM_MERCHANT_ID}`
  );

  const activeCount = CROSSREM_CATALOG_BINDINGS.filter(
    (binding) => !binding.retired
  ).length;
  if (!CROSSREM_MERCHANT_ID || activeCount === 0) {
    throw new Error('CrossRem catalog is unconfigured');
  }

  const merchant = await resolveFeedMerchant(CROSSREM_MERCHANT_ID, false);
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  if (merchant.id !== CROSSREM_MERCHANT_ID || currency !== 'NGN') {
    throw new Error('CrossRem merchant unavailable');
  }

  const data = await getCachedGoogleMerchantFeedData(
    merchant.id,
    merchant.slug
  );
  const rows = collectGoogleMerchantListings(
    data.products,
    // Retain a bound SKU even when Google switches its representative family row.
    { ...merchant, gmc_variants_enabled: true },
    buildMerchantBaseUrl({
      slug: data.slug,
      custom_domain: data.custom_domain,
    }),
    data.imageManifest
  );
  const listings = projectCatalog(rows, CROSSREM_CATALOG_BINDINGS);
  if (listings.length !== activeCount) {
    const resolvedIds = new Set(listings.map((listing) => listing.listing_id));
    const sampleListingIds = CROSSREM_CATALOG_BINDINGS.filter(
      (binding) => !binding.retired && !resolvedIds.has(binding.listingId)
    )
      .slice(0, 10)
      .map((binding) => binding.listingId);
    logger.warn({
      message: 'CrossRem snapshot incomplete',
      merchantId: merchant.id,
      missingCount: activeCount - listings.length,
      sampleListingIds,
    });
    throw new Error('Incomplete CrossRem catalog');
  }

  return { schema_version: 1, currency, listings };
}
