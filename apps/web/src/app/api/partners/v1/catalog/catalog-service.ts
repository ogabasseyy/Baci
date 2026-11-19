import { collectGoogleMerchantListings } from '@/app/api/feed/google-merchant/collect-google-merchant-listings';
import { getCachedGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { buildMerchantBaseUrl } from '@/app/api/feed/google-merchant/route-utils';
import { resolveFeedMerchant } from '@/lib/feed-identifier';
import { logger } from '@/lib/logger';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { crossRemCatalogConfig } from './catalog-bindings';
import { projectCatalog } from './project-catalog';

export async function loadCrossRemCatalog() {
  const { merchantId, bindings } = crossRemCatalogConfig;
  const activeCount = bindings.filter((binding) => !binding.retired).length;
  if (!merchantId || bindings.length === 0) {
    logger.warn({
      message: 'CrossRem catalog is unconfigured',
      merchantId,
      activeCount,
    });
    throw new Error('CrossRem catalog is unconfigured');
  }

  const merchant = await resolveFeedMerchant(merchantId, false).catch(
    (error: unknown) => {
      logger.warn({ message: 'CrossRem merchant lookup failed', merchantId });
      throw error;
    }
  );
  const currency = resolveMerchantCurrencyConfig(merchant).code;
  if (merchant.id !== merchantId || currency !== 'NGN') {
    logger.warn({
      message: 'CrossRem merchant unavailable',
      expectedMerchantId: merchantId,
      resolvedMerchantId: merchant.id,
      currency,
    });
    throw new Error('CrossRem merchant unavailable');
  }

  if (activeCount === 0) {
    return {
      schema_version: 1,
      currency,
      listings: projectCatalog([], bindings),
    };
  }

  // The full partner response is too large for a single hosted cache entry.
  // Reuse Google's cached source data and build the response per request.
  const data = await getCachedGoogleMerchantFeedData(
    merchant.id,
    merchant.slug
  ).catch((error: unknown) => {
    logger.warn({ message: 'CrossRem catalog source read failed', merchantId });
    throw error;
  });
  const rows = collectGoogleMerchantListings(
    data.products,
    // Resolve the pinned SKU even when Google selects a different family row.
    { ...merchant, gmc_variants_enabled: true },
    buildMerchantBaseUrl({
      slug: data.slug,
      custom_domain: data.custom_domain,
    }),
    data.imageManifest
  );
  const listings = projectCatalog(rows, bindings);
  if (listings.length !== activeCount) {
    const resolvedIds = new Set(listings.map((listing) => listing.listing_id));
    const sampleListingIds = bindings
      .filter(
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
