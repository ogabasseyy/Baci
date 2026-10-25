import { headers } from 'next/headers';
import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import {
  getCachedCategoryPageData,
  getMerchantByIdentifier,
  getPublicProductVariantsByProductIds,
} from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildStoreUrl } from '@/lib/store-url';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';
import {
  getCountryShoppingContext,
  getStorefrontLocale,
} from '@/lib/storefront-localization';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { isDomainIdentifier } from '@/lib/validation';
import { buildPriceBandCandidate } from './compare-eligibility';
import { selectPriceBandOffer } from './price-band-offer';
import { getCuratedPriceBands } from './price-band-taxonomy';

function isRawDbProduct(value: unknown): value is RawDbProduct {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'name' in value &&
      'price' in value
  );
}

export async function getPriceBandStorefrontPathPrefix(
  routeIdentifier: string,
  merchantSlug: string
) {
  const headersList = await headers();

  return headersList.has('x-custom-domain') ||
    headersList.has('x-merchant-slug') ||
    isDomainIdentifier(routeIdentifier)
    ? ''
    : getStorefrontPathPrefix(headersList, merchantSlug);
}

function getSupportedClusterCategory(
  categorySlug: string
): SupportedClusterCategory | null {
  return categorySlug in CONTENT_CLUSTER_SUPPORT
    ? (categorySlug as SupportedClusterCategory)
    : null;
}

const _priceBandFormatterCache = new Map<string, Intl.NumberFormat>();

function getPriceBandFormatter(
  locale: string,
  currency: string
): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let formatter = _priceBandFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    _priceBandFormatterCache.set(key, formatter);
  }
  return formatter;
}

export async function loadPriceBandPage(
  args: {
    merchantSlug: string;
    categorySlug: string;
    priceBandSlug: string;
  },
  options: { includeRequestPathPrefix?: boolean } = {}
) {
  const includeRequestPathPrefix = options.includeRequestPathPrefix ?? true;

  const merchant = await getMerchantByIdentifier(args.merchantSlug);

  if (!merchant) {
    return null;
  }

  // Over-long / repeatedly-encoded bot segments can never match a category or
  // curated band; bail before getCachedCategoryPageData ->
  // getCachedCategoryPageShellData (local `'use cache'`, keyed on
  // categorySlug) runs with an unbounded key — the cached category fetch runs
  // BEFORE the curated-band check, so an unsafe priceBandSlug would otherwise
  // still trigger it. (merchantSlug is already bounded by
  // getMerchantByIdentifier above.)
  if (
    !evaluateStorefrontSlugSafety(args.categorySlug).safe ||
    !evaluateStorefrontSlugSafety(args.priceBandSlug).safe
  ) {
    return null;
  }

  const band = getCuratedPriceBands(args.categorySlug).find(
    (candidate) => candidate.slug === args.priceBandSlug
  );

  if (!band) {
    return null;
  }

  const categoryData = await getCachedCategoryPageData(
    merchant.id,
    args.categorySlug,
    args.merchantSlug
  );

  if (!categoryData || categoryData.isCollection) {
    return null;
  }

  if (
    categoryData.categoryQueryFailed ||
    categoryData.productsQueryFailed ||
    categoryData.productIdsQueryFailed
  ) {
    throw new Error('Price band inventory is temporarily unavailable');
  }

  const rawProducts = ((categoryData.products ?? []) as unknown[]).filter(
    isRawDbProduct
  );
  const variantsByProductId = await getPublicProductVariantsByProductIds(
    merchant.id,
    rawProducts.map((product) => product.id)
  );
  const products = rawProducts
    .map((product) =>
      selectPriceBandOffer(
        { ...product, product_variants: variantsByProductId[product.id] ?? [] },
        args.categorySlug,
        band.ceiling,
        band.floor
      )
    )
    .filter(
      (product): product is NonNullable<typeof product> => product !== null
    )
    .sort(
      (left, right) =>
        left.price - right.price || left.id.localeCompare(right.id)
    );

  const bandCandidate = buildPriceBandCandidate({
    categorySlug: args.categorySlug,
    band,
    products: products.map((product) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      price: product.price,
    })),
  });

  const storeUrl = buildStoreUrl(merchant);
  const supportedClusterCategory = getSupportedClusterCategory(
    args.categorySlug
  );
  const guidePosts = supportedClusterCategory
    ? await loadPublishedClusterPostsSafely(merchant.id, {
        pageKind: 'price-band',
        categorySlug: supportedClusterCategory,
        priceBandSlug: band.slug,
      })
    : [];
  const categoryName = categoryData.fallbackName || args.categorySlug;
  const canonicalUrl = `${storeUrl}/${args.categorySlug}/best-under/${band.slug}`;
  const payoutCurrency = resolveMerchantCurrencyConfig(merchant).code;
  const priceFormatter = getPriceBandFormatter(
    getStorefrontLocale(merchant.country),
    payoutCurrency
  );
  const ceilingText = priceFormatter.format(band.ceiling);
  const countryContext = getCountryShoppingContext(merchant.country);
  const countrySuffix = countryContext ? ` ${countryContext}` : '';
  const heading = `Compare ${categoryName} Under ${ceilingText}${countrySuffix}`;
  return {
    merchant,
    canonicalUrl,
    metaTitle: buildStorefrontMetadataTitle({
      title: heading,
      suffix: merchant.business_name,
      fallback: categoryName,
    }).title,
    metaDescription: `Compare ${categoryName.toLowerCase()} under ${ceilingText}${countrySuffix}. See priced configurations, condition, and ordering availability from ${merchant.business_name}.`,
    heading,
    intro: `Browse ${categoryName.toLowerCase()} priced strictly below ${ceilingText}${countrySuffix} from ${merchant.business_name}. Compare the exact listed configuration and condition before choosing.`,
    breadcrumbItems: [
      { name: merchant.business_name, url: storeUrl },
      { name: categoryName, url: `${storeUrl}/${args.categorySlug}` },
      { name: heading, url: canonicalUrl },
    ],
    products,
    guideLinks: supportedClusterCategory
      ? buildCommercialGuideLinks({
          storeUrl,
          posts: guidePosts,
          context: {
            pageKind: 'price-band',
            categorySlug: supportedClusterCategory,
            priceBandSlug: band.slug,
          },
        })
      : [],
    isIndexable: bandCandidate.isIndexable,
    pathPrefix: includeRequestPathPrefix
      ? await getPriceBandStorefrontPathPrefix(args.merchantSlug, merchant.slug)
      : '',
    payoutCurrency,
  };
}
