import { cacheLife, cacheTag } from 'next/cache';
import { cache } from 'react';
import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import {
  type CachedMerchant,
  getCachedProductWithDetails,
  getMerchantByIdentifier,
} from '@/lib/cached-data';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { generateSlug } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildCommercialGuideLinks } from '@/lib/storefront-content/build-commercial-guide-links';
import type {
  BuildCommercialGuideLinksContext,
  InformationalGuideLink,
  SupportedClusterCategory,
} from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';
import type { CompareLinkGraphEntry } from '@/lib/storefront-link-modules/compare-link-graph';
import {
  appendCountryContext,
  getCountryShoppingContext,
  getStorefrontLocale,
} from '@/lib/storefront-localization';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  buildProductComparisonMatrix,
  type ProductComparisonMatrix,
} from '@/lib/storefront-specs/spec-matrix';
import type { ComparableProductKeySpecs } from '@/lib/storefront-specs/spec-taxonomy';
import { buildCompareGuideContexts } from './build-compare-guide-contexts';
import { extractComparableKeySpecs } from './comparable-key-specs';
import {
  buildBrandCompareCandidate,
  buildProductCompareCandidate,
} from './compare-eligibility';
import {
  buildCuratedCompareSlugSet,
  isCuratedCompareSlug,
} from './compare-indexability-policy';
import {
  buildRelatedCompareLinks,
  includeClickedCompareProducts,
  loadCompareGraphProducts,
} from './compare-page-link-helpers';
import { parseCompareSlug } from './compare-slugs';
import {
  type CompareCategoryInventoryProduct,
  getCachedCompareCategoryInventory,
} from './get-cached-compare-category-inventory';
import { getCachedMaintainedCompareRouteManifest } from './get-cached-maintained-compare-route-manifest';

interface CompareBreadcrumbItem {
  name: string;
  url: string;
}

interface CompareFAQItem {
  question: string;
  answer: string;
}

interface ComparisonRow {
  label: string;
  leftValue: string;
  rightValue: string;
}

interface ComparableCategoryProduct {
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  category_slug: string;
  status?: string | null;
  product_key_specs: ComparableProductKeySpecs | null;
}

interface ProductComparePageModel {
  kind: 'product';
  canonicalSlug: string;
  canonicalUrl: string;
  metaTitle: string;
  metaDescription: string;
  heading: string;
  summaryVerdict: string;
  keyDifferences: string[];
  comparisonRows: ComparisonRow[];
  comparisonMatrix: ProductComparisonMatrix;
  faqItems: CompareFAQItem[];
  breadcrumbItems: CompareBreadcrumbItem[];
  guideLinks: InformationalGuideLink[];
  relatedCompareLinks: CompareLinkGraphEntry[];
  merchant: CachedMerchant;
  isIndexable: boolean;
  isLegacyFallback: boolean;
  leftProduct: Awaited<ReturnType<typeof getCachedProductWithDetails>>;
  rightProduct: Awaited<ReturnType<typeof getCachedProductWithDetails>>;
}

interface BrandComparePageModel {
  kind: 'brand';
  canonicalSlug: string;
  canonicalUrl: string;
  metaTitle: string;
  metaDescription: string;
  heading: string;
  summaryVerdict: string;
  keyDifferences: string[];
  comparisonRows: ComparisonRow[];
  faqItems: CompareFAQItem[];
  breadcrumbItems: CompareBreadcrumbItem[];
  guideLinks: InformationalGuideLink[];
  relatedCompareLinks: CompareLinkGraphEntry[];
  merchant: CachedMerchant;
  isIndexable: boolean;
  isLegacyFallback: boolean;
  leftBrand: string;
  rightBrand: string;
}

const CURATED_COMPARE_POLICY_DOC =
  'docs/superpowers/plans/2026-06-07-ogabassey-shared-comparison-spec-matrix.md';

// Title uniqueness outranks SERP display length: Google reads the full
// <title> (SERP truncation is pixel-based display-only), while the default
// 60-char cap slices away the right-hand product's distinguishing model
// tokens and makes dozens of "X vs Y" pages share byte-identical titles.
// Cap only pathological product-name pairs.
const COMPARE_META_TITLE_MAX_LENGTH = 150;

const _comparePriceFormatterCache = new Map<string, Intl.NumberFormat>();

function getComparePriceFormatter(
  locale: string,
  currency: string
): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let formatter = _comparePriceFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    _comparePriceFormatterCache.set(key, formatter);
  }
  return formatter;
}

function buildComparisonRowsFromMatrix(
  matrix: ProductComparisonMatrix
): ComparisonRow[] {
  return matrix.flatRows
    .map((row) => ({
      label: row.label,
      leftValue: row.values[0] || '—',
      rightValue: row.values[1] || '—',
    }))
    .filter((row) => row.leftValue !== '—' || row.rightValue !== '—');
}

function buildComparableKeySpecsFromMatrix(
  matrix: ProductComparisonMatrix,
  columnIndex: number
): ComparableProductKeySpecs {
  return Object.fromEntries(
    matrix.flatRows
      .map((row) => [generateSlug(row.label), row.values[columnIndex]])
      .filter(([_key, value]) => value && value !== '—')
      .filter(([key, value]) => Boolean(key) && Boolean(value))
  );
}

function buildDifferenceSummaries(
  leftName: string,
  rightName: string,
  rows: ComparisonRow[]
) {
  const differingRows = rows.filter((row) => row.leftValue !== row.rightValue);

  if (differingRows.length === 0) {
    return [
      `${leftName} and ${rightName} overlap heavily on core specifications.`,
    ];
  }

  return differingRows
    .slice(0, 3)
    .map(
      (row) =>
        `${row.label}: ${leftName} ${row.leftValue}, ${rightName} ${row.rightValue}`
    );
}

function summarizeDifferenceLabels(keyDifferences: string[]) {
  const labels = keyDifferences
    .map((item) => item.split(':')[0]?.trim()?.toLowerCase())
    .filter((label): label is string => Boolean(label))
    .slice(0, 2);

  return labels.length > 0 ? labels.join(' and ') : 'price and specifications';
}

function formatPriceRange(
  products: ComparableCategoryProduct[],
  priceFormatter: Intl.NumberFormat
) {
  const prices = products.map((product) => product.price);

  if (prices.length === 0) {
    return '—';
  }

  return `${priceFormatter.format(Math.min(...prices))} to ${priceFormatter.format(
    Math.max(...prices)
  )}`;
}

function selectByPrice(
  products: ComparableCategoryProduct[],
  direction: 'asc' | 'desc'
) {
  return (
    products
      .slice()
      .sort((left, right) =>
        direction === 'asc'
          ? left.price - right.price
          : right.price - left.price
      )[0]?.name || '—'
  );
}

function getSupportedClusterCategory(
  categorySlug: string
): SupportedClusterCategory | null {
  return categorySlug in CONTENT_CLUSTER_SUPPORT
    ? (categorySlug as SupportedClusterCategory)
    : null;
}

function logCompareRouteMiss(details: {
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
  reason: string;
  canonicalSlug?: string;
}) {
  console.warn('COMPARE_ROUTE_404', {
    ...details,
    policy: CURATED_COMPARE_POLICY_DOC,
  });
}

function logNonCuratedCompareFallback(details: {
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
  canonicalSlug: string;
}) {
  console.warn('COMPARE_NON_CURATED_FALLBACK', {
    ...details,
    policy: CURATED_COMPARE_POLICY_DOC,
  });
}

function loadSupportedGuidePosts(
  merchantId: string,
  context: BuildCommercialGuideLinksContext | null
) {
  return context
    ? loadPublishedClusterPostsSafely(merchantId, context)
    : Promise.resolve([]);
}

interface CanonicalCompareIndexability {
  isCanonicalSlugIndexable: boolean;
  isCanonicalSlugCurated: boolean;
}

type CachedComparePageModel =
  | (Omit<ProductComparePageModel, 'isIndexable' | 'isLegacyFallback'> &
      CanonicalCompareIndexability)
  | (Omit<BrandComparePageModel, 'isIndexable' | 'isLegacyFallback'> &
      CanonicalCompareIndexability);

// Request-degradable auxiliary data — buyer-guide and semantic-graph related
// links — is loaded PER REQUEST by applyComparePageOverlay, NOT inside the
// cached model. A maintained-route decision is instead computed once from the
// bounded inventory in the core before product details hydrate. Auxiliary
// failures therefore degrade only the current request's links, never route
// approval or a valid page's cache entry.
interface ProductCompareOverlayContext {
  kind: 'product';
  storeUrl: string;
  storeSlug: string;
  categorySlug: string;
  categoryName: string;
  canonicalSlug: string;
  leftProduct: CompareCategoryInventoryProduct;
  rightProduct: CompareCategoryInventoryProduct;
  leftProductSlug: string;
  rightProductSlug: string;
  candidateIsIndexable: boolean;
  isMaintainedCanonicalSlug: boolean;
  guideLoadContext: BuildCommercialGuideLinksContext | null;
  guideBuildContext: BuildCommercialGuideLinksContext | null;
}

interface BrandCompareOverlayContext {
  kind: 'brand';
  storeUrl: string;
  guideContext: BuildCommercialGuideLinksContext | null;
}

type CachedComparePageCore =
  | (Omit<
      ProductComparePageModel,
      'isIndexable' | 'isLegacyFallback' | 'guideLinks' | 'relatedCompareLinks'
    > & { overlay: ProductCompareOverlayContext })
  | (Omit<
      BrandComparePageModel,
      'isIndexable' | 'isLegacyFallback' | 'guideLinks' | 'relatedCompareLinks'
    > &
      CanonicalCompareIndexability & { overlay: BrandCompareOverlayContext });

export async function loadComparePage(args: {
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
}): Promise<ProductComparePageModel | BrandComparePageModel | null> {
  // Resolve the merchant BEFORE any compare cache key is formed: unknown or
  // over-long identifiers exit here (bounded inside getMerchantByIdentifier),
  // so they never become `'use cache'` cache keys — and the resolved tenant id
  // becomes part of both the per-request memo key and the remote cache key.
  // A storefront identifier is NOT tenant-stable across time (slugs can be
  // renamed and reused; custom domains can be detached and reassigned), so the
  // identifier alone must never key merchant-specific cached content.
  const merchant = await getMerchantByIdentifier(args.merchantSlug);

  if (!merchant) {
    return null;
  }

  return loadComparePageForRoute(
    merchant.id,
    args.merchantSlug,
    args.categorySlug,
    args.comparisonSlug
  );
}

const loadComparePageForRoute = cache(
  (
    merchantId: string,
    merchantSlug: string,
    categorySlug: string,
    comparisonSlug: string
  ) =>
    loadComparePageForRequest({
      merchantId,
      merchantSlug,
      categorySlug,
      comparisonSlug,
    })
);

function finalizeComparePageModel(
  model: CachedComparePageModel,
  isCanonicalSlugRequest: boolean
): ProductComparePageModel | BrandComparePageModel {
  const isCuratedIndexableRequest =
    isCanonicalSlugRequest && model.isCanonicalSlugCurated;
  const isIndexable = isCanonicalSlugRequest && model.isCanonicalSlugIndexable;

  if (model.kind === 'product') {
    const {
      isCanonicalSlugCurated: _curated,
      isCanonicalSlugIndexable: _indexable,
      ...pageModel
    } = model;
    return {
      ...pageModel,
      isIndexable,
      isLegacyFallback: !isCuratedIndexableRequest,
    };
  }

  const {
    isCanonicalSlugCurated: _curated,
    isCanonicalSlugIndexable: _indexable,
    ...pageModel
  } = model;
  return {
    ...pageModel,
    isIndexable,
    isLegacyFallback: !isCuratedIndexableRequest,
  };
}

async function loadComparePageForRequest(args: {
  merchantId: string;
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
}): Promise<ProductComparePageModel | BrandComparePageModel | null> {
  // Over-long / repeatedly-encoded bot categories can never match; bail before
  // getCachedComparePageModel -> getCachedCompareCategoryInventory
  // (local `'use cache'`, keyed on categorySlug) runs with an unbounded key.
  // comparisonSlug is NOT gated here: it's a composite `${left}-vs-${right}` of
  // two product slugs (each up to 200 chars), so the single-slug bound would
  // wrongly 404 legitimate long compare URLs. The parsed halves are gated after
  // parsing instead.
  if (!evaluateStorefrontSlugSafety(args.categorySlug).safe) {
    // Bound the logged slugs — an unsafe segment can be multi-KB and must not
    // bloat the log line (the other misses log post-gate, already-bounded slugs).
    logCompareRouteMiss({
      merchantSlug: args.merchantSlug,
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'unsafe_slug',
    });
    return null;
  }

  const parsed = parseCompareSlug(args.comparisonSlug);

  if (!parsed) {
    logCompareRouteMiss({
      ...args,
      reason: 'invalid_compare_slug',
    });
    return null;
  }

  // Gate the parsed halves (each a single product slug) before either reaches
  // getCachedProductWithDetails (`'use cache'`) or becomes part of the cached
  // compare model key. A valid product slug (<=200) passes; an over-long /
  // repeatedly-encoded half from a bot `-vs-` blob does not, so the unbounded
  // value never enters a cache key.
  if (
    !evaluateStorefrontSlugSafety(parsed.leftKey).safe ||
    !evaluateStorefrontSlugSafety(parsed.rightKey).safe
  ) {
    logCompareRouteMiss({
      merchantSlug: args.merchantSlug,
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'unsafe_compare_key',
    });
    return null;
  }

  let core: CachedComparePageCore | null;

  try {
    core = await getCachedComparePageModel(
      args.merchantId,
      args.merchantSlug,
      args.categorySlug,
      parsed.canonicalSlug
    );
  } catch (error) {
    // Degrade the single failing request instead of poisoning the cache (the
    // cached builder throws on transient LOAD-BEARING failures — inventory /
    // product details — so they are never stored). Compare pages keep today's
    // 404-on-transient-failure semantics for data the page genuinely needs.
    console.error('Failed to load compare page model', {
      merchantSlug: args.merchantSlug,
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      error,
    });
    return null;
  }

  if (!core) {
    return null;
  }

  // Overlay the request-degradable auxiliary data (guide + graph) OUTSIDE the
  // remote cache: a transient failure here yields empty links / curated-slug
  // fallback indexability for this one request without caching it or 404ing.
  const model = await applyComparePageOverlay(core, args.merchantId);

  const isCanonicalSlugRequest = args.comparisonSlug === parsed.canonicalSlug;

  if (!(isCanonicalSlugRequest && model.isCanonicalSlugCurated)) {
    logNonCuratedCompareFallback({
      merchantSlug: args.merchantSlug,
      categorySlug: args.categorySlug,
      comparisonSlug: args.comparisonSlug,
      canonicalSlug: parsed.canonicalSlug,
    });
  }

  return finalizeComparePageModel(model, isCanonicalSlugRequest);
}

/**
 * Loads the request-degradable auxiliary data (buyer-guide links and the
 * semantic-graph related links + graph-based product indexability) on top of
 * the cached core, PER REQUEST. Runs outside the remote cache so a transient
 * guide-RPC or semantic-inventory failure degrades only the current request
 * (empty links, curated-slug fallback indexability) — it is never cached for
 * the model's `categories` window, and it never turns an auxiliary-data outage
 * into a 404 for an otherwise-valid compare page.
 */
async function applyComparePageOverlay(
  core: CachedComparePageCore,
  merchantId: string
): Promise<CachedComparePageModel> {
  // Discriminate on core.kind (not the destructured overlay) so `pageModel`
  // narrows to the matching model variant.
  if (core.kind === 'brand') {
    const { overlay, ...pageModel } = core;
    const guidePosts = await loadSupportedGuidePosts(
      merchantId,
      overlay.guideContext
    );
    return {
      ...pageModel,
      guideLinks: overlay.guideContext
        ? buildCommercialGuideLinks({
            storeUrl: overlay.storeUrl,
            posts: guidePosts,
            context: overlay.guideContext,
          })
        : [],
      relatedCompareLinks: [],
    };
  }

  const { overlay, ...pageModel } = core;
  const [guidePosts, compareGraphProducts] = await Promise.all([
    loadSupportedGuidePosts(merchantId, overlay.guideLoadContext),
    loadCompareGraphProducts({
      categorySlug: overlay.categorySlug,
      merchantId,
      storeSlug: overlay.storeSlug,
    }),
  ]);
  const semanticCompareProducts = compareGraphProducts.products;
  const routeApprovalProducts = compareGraphProducts.failed
    ? semanticCompareProducts
    : includeClickedCompareProducts({
        products: semanticCompareProducts,
        clickedProducts: [overlay.leftProduct, overlay.rightProduct],
      });
  const relatedCompareLinks = buildRelatedCompareLinks({
    storeUrl: overlay.storeUrl,
    categorySlug: overlay.categorySlug,
    categoryName: overlay.categoryName,
    products: routeApprovalProducts,
    leftProductSlug: overlay.leftProductSlug,
    rightProductSlug: overlay.rightProductSlug,
    currentComparisonSlug: overlay.canonicalSlug,
  });
  return {
    ...pageModel,
    guideLinks: overlay.guideBuildContext
      ? buildCommercialGuideLinks({
          storeUrl: overlay.storeUrl,
          posts: guidePosts,
          context: overlay.guideBuildContext,
        })
      : [],
    relatedCompareLinks,
    isCanonicalSlugIndexable:
      overlay.candidateIsIndexable && overlay.isMaintainedCanonicalSlug,
    isCanonicalSlugCurated: overlay.isMaintainedCanonicalSlug,
  };
}

/**
 * Canonical compare page model, cached as ONE small remote entry per compare
 * URL. Compare-page resumes previously ran the whole data pipeline (category
 * payload, product details, link graph, guide posts) on every request; under
 * crawler load the accumulated cache traffic stalled large-category compare
 * pages for ~30s per request. The model is request-form-agnostic: it is keyed
 * by the canonical slug, and request-dependent indexability flags are derived
 * outside by the per-request wrapper.
 *
 * The key includes the caller-resolved tenant id (`merchantId`), NOT just the
 * storefront identifier: slugs can be renamed and reused and custom domains
 * reassigned, so an identifier-only key could replay the previous tenant's
 * cached model to the new tenant until an unrelated tag invalidation.
 *
 * Callers MUST slug-safety-gate every segment before calling (see
 * loadComparePageForRequest) so unbounded bot input never becomes a cache key.
 *
 * Only load-bearing data is fetched here (category inventory, product details)
 * and it THROWS on transient failure so the failure is never cached. Request-
 * degradable auxiliary data (guide + semantic-graph links) is deliberately NOT
 * fetched here — the returned `overlay` carries the inputs for
 * applyComparePageOverlay to load it per-request outside the cache.
 */
async function getCachedComparePageModel(
  merchantId: string,
  merchantSlug: string,
  categorySlug: string,
  canonicalSlug: string
): Promise<CachedComparePageCore | null> {
  // LOCAL 'use cache' (not remote): this entry embeds both full product-detail
  // payloads, so its Vercel remote-cache SET (RemoteCacheHandler K.set) hangs to
  // an internal timeout and NEVER persists — every request re-does the ~30s cold
  // fill (verified in prod: constant ~34s, scales with category size, never
  // serves warm, zero query/timeout/retry errors logged). Local cache has no
  // write round-trip, so a cold fill costs only the (<3s) data work. Mirrors the
  // getCachedMerchant / getCachedProductWithDetails precedent kept local for the
  // same RemoteCacheHandler failures.
  'use cache';
  try {
    // 'products' (revalidate 1800), NOT 'categories' (3600): now that this is a
    // LOCAL entry, tag revalidation only evicts the instance that handled the
    // mutation — other instances serve the prior snapshot until their window
    // lapses. This model embeds mutable product price/stock (via
    // getCachedProductWithDetails, itself local 'use cache' on the same
    // 'products' window), so match that window to bound cross-instance staleness
    // of the embedded data to ~30min and cap how long each per-slug entry
    // lingers in a lambda's local cache.
    cacheLife('products');
    cacheTag('category-page-data', 'products', 'categories', 'blog-posts');
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  const merchant = await getMerchantByIdentifier(merchantSlug);

  if (!merchant) {
    return null;
  }

  // The cache key already includes the caller-resolved tenant id. If the
  // identifier now maps to a DIFFERENT merchant (slug renamed and reused,
  // custom domain reassigned), this fill was raced by the mapping change —
  // return null rather than build a model for the wrong tenant; the wrapper's
  // fresher resolution supplies the matching id on the next request.
  if (merchant.id !== merchantId) {
    return null;
  }

  try {
    cacheTag(
      `products-${merchant.id}`,
      `categories-${merchant.id}`,
      `features-${merchant.id}`,
      // Nested `use cache` entries have INDEPENDENT tags — an inner entry's tag
      // does not bubble up to this outer model. This model EMBEDS merchant
      // profile / branding / currency copy and precomputed storeUrl + titles,
      // so it must carry the merchant tags revalidateMerchant() fires or a
      // settings / slug / branding change serves stale compare pages until the
      // 'categories' window: `merchants`, `merchant-id-${id}`, `merchant-${slug}`.
      'merchants',
      `merchant-id-${merchant.id}`,
      `merchant-${merchant.slug}`
    );
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  const args = { merchantSlug, categorySlug, comparisonSlug: canonicalSlug };
  const parsed = parseCompareSlug(canonicalSlug);

  if (!parsed) {
    logCompareRouteMiss({
      ...args,
      reason: 'invalid_compare_slug',
    });
    return null;
  }

  const inventory = await getCachedCompareCategoryInventory(
    merchant.id,
    categorySlug
  );

  if (inventory.isCollection) {
    logCompareRouteMiss({
      ...args,
      canonicalSlug: parsed.canonicalSlug,
      reason: 'collection_category',
    });
    return null;
  }

  const normalizedProducts = inventory.products;
  const storeUrl = buildStoreUrl(merchant);
  const categoryName = inventory.fallbackName || categorySlug;
  const canonicalUrl = `${storeUrl}/${categorySlug}/compare/${parsed.canonicalSlug}`;
  const supportedClusterCategory = getSupportedClusterCategory(categorySlug);
  const payoutCurrency = resolveMerchantCurrencyConfig(merchant).code;
  const priceFormatter = getComparePriceFormatter(
    getStorefrontLocale(merchant.country),
    payoutCurrency
  );
  const countryContext = getCountryShoppingContext(merchant.country);
  const countrySuffix = countryContext ? ` ${countryContext}` : '';
  const leftProduct = normalizedProducts.find(
    (product) => product.slug === parsed.leftKey
  );
  const rightProduct = normalizedProducts.find(
    (product) => product.slug === parsed.rightKey
  );
  const curatedCompareSlugs = buildCuratedCompareSlugSet({
    storeUrl,
    categorySlug: args.categorySlug,
    categoryName,
    products: normalizedProducts,
  });
  const isCuratedCanonicalSlug = isCuratedCompareSlug(
    parsed.canonicalSlug,
    curatedCompareSlugs
  );
  if (leftProduct && rightProduct) {
    const maintainedRouteManifest = new Set(
      await getCachedMaintainedCompareRouteManifest(
        merchant.id,
        args.categorySlug,
        args.merchantSlug,
        storeUrl
      )
    );

    if (!maintainedRouteManifest.has(parsed.canonicalSlug)) {
      logCompareRouteMiss({
        ...args,
        canonicalSlug: parsed.canonicalSlug,
        reason: 'unapproved_product_compare_route',
      });
      return null;
    }

    // Only the load-bearing product details are fetched inside the cache. The
    // guide + semantic-graph loads moved to applyComparePageOverlay (outside
    // the cache) so their transient failures degrade one request instead of
    // being frozen for the cache window or 404ing valid pages.
    const [leftDetails, rightDetails] = await Promise.all([
      getCachedProductWithDetails(merchant.id, parsed.leftKey),
      getCachedProductWithDetails(merchant.id, parsed.rightKey),
    ]);

    if (!leftDetails || !rightDetails) {
      // The cached inventory just said both products exist and are active, so
      // a missing detail payload here is almost always a transient fetch
      // failure (getCachedProductWithDetails returns null on query errors
      // instead of throwing). Throw so Cache Components never stores this as
      // a cached 404 for the whole revalidate window — the per-request
      // wrapper degrades this single request to null instead.
      throw new Error(
        `Compare product details unavailable for ${!leftDetails ? parsed.leftKey : parsed.rightKey}`
      );
    }

    // Both detail payloads (comparison table + structured-data offers /
    // availability) are embedded in this model. Per-product invalidation —
    // e.g. checkout stock updates call revalidateProductSlugs(), which purges
    // ONLY getProductScopedCacheTag('product', merchantId, slug) and NOT the
    // merchant-wide products-${id} tag this model already carries — would not
    // reach this outer entry without an explicit product-scoped tag (nested
    // `use cache` tags don't bubble up). Tag both the parsed URL keys AND the
    // resolved detail slugs (they can differ for alias / uuid input).
    try {
      const productTagSlugs = new Set<string>([
        parsed.leftKey,
        parsed.rightKey,
      ]);
      if (leftDetails.slug) {
        productTagSlugs.add(leftDetails.slug);
      }
      if (rightDetails.slug) {
        productTagSlugs.add(rightDetails.slug);
      }
      for (const productSlug of productTagSlugs) {
        cacheTag(getProductScopedCacheTag('product', merchant.id, productSlug));
      }
    } catch {
      // Unit tests do not run with Next cacheComponents enabled.
    }

    const comparisonMatrix = buildProductComparisonMatrix({
      products: [
        {
          ...leftDetails,
          product_key_specs: extractComparableKeySpecs(
            leftDetails.product_key_specs
          ),
        },
        {
          ...rightDetails,
          product_key_specs: extractComparableKeySpecs(
            rightDetails.product_key_specs
          ),
        },
      ],
    });
    const comparisonRows = buildComparisonRowsFromMatrix(comparisonMatrix);
    const keyDifferences = buildDifferenceSummaries(
      leftDetails.name,
      rightDetails.name,
      comparisonRows
    );
    const leftComparableKeySpecs =
      extractComparableKeySpecs(leftDetails.product_key_specs) ||
      buildComparableKeySpecsFromMatrix(comparisonMatrix, 0);
    const rightComparableKeySpecs =
      extractComparableKeySpecs(rightDetails.product_key_specs) ||
      buildComparableKeySpecsFromMatrix(comparisonMatrix, 1);
    const candidate = buildProductCompareCandidate({
      categorySlug: args.categorySlug,
      leftProduct: {
        slug: leftDetails.slug || parsed.leftKey,
        name: leftDetails.name,
        category_slug: leftProduct.category_slug,
        product_key_specs: leftComparableKeySpecs,
      },
      rightProduct: {
        slug: rightDetails.slug || parsed.rightKey,
        name: rightDetails.name,
        category_slug: rightProduct.category_slug,
        product_key_specs: rightComparableKeySpecs,
      },
    });
    const differenceLabels = summarizeDifferenceLabels(keyDifferences);
    const breadcrumbItems = [
      { name: merchant.business_name, url: storeUrl },
      { name: categoryName, url: `${storeUrl}/${args.categorySlug}` },
      {
        name: `${leftDetails.name} vs ${rightDetails.name}`,
        url: canonicalUrl,
      },
    ];

    const compareLabel = appendCountryContext(
      `${leftDetails.name} vs ${rightDetails.name}`,
      countryContext
    );
    const compareGuideContexts = buildCompareGuideContexts({
      supportedClusterCategory,
      leftBrand: leftDetails.brand,
      rightBrand: rightDetails.brand,
      leftName: leftDetails.name,
      rightName: rightDetails.name,
      leftLoadSlug: parsed.leftKey,
      rightLoadSlug: parsed.rightKey,
      leftBuildSlug: leftDetails.slug || parsed.leftKey,
      rightBuildSlug: rightDetails.slug || parsed.rightKey,
    });
    return {
      kind: 'product',
      canonicalSlug: parsed.canonicalSlug,
      canonicalUrl,
      // The page model stores a plain string; the route wraps it as
      // Metadata.title.absolute when composing the final Next metadata object.
      metaTitle: buildStorefrontMetadataTitle({
        title: compareLabel,
        suffix: merchant.business_name,
        fallback: categoryName,
        maxLength: COMPARE_META_TITLE_MAX_LENGTH,
      }).title,
      metaDescription: `Compare ${leftDetails.name} vs ${rightDetails.name}${countrySuffix} by price, specs, condition, warranty, delivery, and buying priorities on ${merchant.business_name}.`,
      heading: compareLabel,
      summaryVerdict: `${leftDetails.name} and ${rightDetails.name} both target ${categoryName.toLowerCase()} buyers${countrySuffix}, but the deciding factors are ${differenceLabels}.`,
      keyDifferences,
      comparisonRows,
      comparisonMatrix,
      faqItems: [
        {
          question: `Which is better${countrySuffix}, ${leftDetails.name} or ${rightDetails.name}?`,
          answer: `Use the comparison table to choose based on the price, condition, and specs that matter most to you, especially ${differenceLabels}.`,
        },
        {
          question: `Which has better value for the price${countrySuffix}?`,
          answer: `${leftDetails.name} is the better fit if its advantages in ${differenceLabels.split(' and ')[0] || 'key specifications'} matter more than the savings on ${rightDetails.name}; otherwise compare current prices and availability before buying.`,
        },
      ],
      breadcrumbItems,
      merchant,
      leftProduct: leftDetails,
      rightProduct: rightDetails,
      // guideLinks, relatedCompareLinks and the graph-based indexability are
      // filled per-request by applyComparePageOverlay (outside the cache).
      overlay: {
        kind: 'product',
        storeUrl,
        storeSlug: args.merchantSlug,
        categorySlug: args.categorySlug,
        categoryName,
        canonicalSlug: parsed.canonicalSlug,
        leftProduct,
        rightProduct,
        leftProductSlug: leftDetails.slug || parsed.leftKey,
        rightProductSlug: rightDetails.slug || parsed.rightKey,
        candidateIsIndexable: candidate.isIndexable,
        isMaintainedCanonicalSlug: true,
        // Faithful to the pre-overlay contexts: the guide LOAD used the raw
        // parsed URL keys, the guide BUILD used the resolved detail slugs.
        ...compareGuideContexts,
      },
    };
  }

  const brandCandidate = buildBrandCompareCandidate({
    categorySlug: args.categorySlug,
    products: normalizedProducts,
  });

  if (
    !brandCandidate ||
    brandCandidate.canonicalSlug !== parsed.canonicalSlug
  ) {
    logCompareRouteMiss({
      merchantSlug: args.merchantSlug,
      categorySlug: args.categorySlug,
      comparisonSlug: args.comparisonSlug,
      canonicalSlug: parsed.canonicalSlug,
      reason: !brandCandidate
        ? 'brand_candidate_not_found'
        : 'brand_candidate_mismatch',
    });
    return null;
  }

  const leftBrandKey = generateSlug(brandCandidate.leftBrand);
  const rightBrandKey = generateSlug(brandCandidate.rightBrand);
  const leftBrandProducts = normalizedProducts.filter(
    (product) => generateSlug(product.brand || '') === leftBrandKey
  );
  const rightBrandProducts = normalizedProducts.filter(
    (product) => generateSlug(product.brand || '') === rightBrandKey
  );
  const comparisonRows: ComparisonRow[] = [
    {
      label: 'Active models',
      leftValue: String(leftBrandProducts.length),
      rightValue: String(rightBrandProducts.length),
    },
    {
      label: 'Price range',
      leftValue: formatPriceRange(leftBrandProducts, priceFormatter),
      rightValue: formatPriceRange(rightBrandProducts, priceFormatter),
    },
    {
      label: 'Cheapest model',
      leftValue: selectByPrice(leftBrandProducts, 'asc'),
      rightValue: selectByPrice(rightBrandProducts, 'asc'),
    },
    {
      label: 'Premium model',
      leftValue: selectByPrice(leftBrandProducts, 'desc'),
      rightValue: selectByPrice(rightBrandProducts, 'desc'),
    },
  ];
  const keyDifferences = [
    `${brandCandidate.leftBrand} has ${brandCandidate.leftBrandActiveCount} active models in this category.`,
    `${brandCandidate.rightBrand} has ${brandCandidate.rightBrandActiveCount} active models in this category.`,
    `${brandCandidate.leftBrand} ranges from ${comparisonRows[1].leftValue}, while ${brandCandidate.rightBrand} ranges from ${comparisonRows[1].rightValue}.`,
  ];
  const heading = appendCountryContext(
    `${brandCandidate.leftBrand} vs ${brandCandidate.rightBrand} ${categoryName}`,
    countryContext
  );
  const breadcrumbItems = [
    { name: merchant.business_name, url: storeUrl },
    { name: categoryName, url: `${storeUrl}/${args.categorySlug}` },
    { name: heading, url: canonicalUrl },
  ];

  return {
    kind: 'brand',
    canonicalSlug: parsed.canonicalSlug,
    canonicalUrl,
    // The page model stores a plain string; the route wraps it as
    // Metadata.title.absolute when composing the final Next metadata object.
    // Same higher cap as the product path: a short default cap can slice a
    // long shared categoryName prefix and collapse distinct brand-vs-brand
    // pages into duplicate titles.
    metaTitle: buildStorefrontMetadataTitle({
      title: heading,
      suffix: merchant.business_name,
      fallback: categoryName,
      maxLength: COMPARE_META_TITLE_MAX_LENGTH,
    }).title,
    metaDescription: `Compare ${brandCandidate.leftBrand} and ${brandCandidate.rightBrand} ${categoryName.toLowerCase()}${countrySuffix} by live model count, price range, warranty, delivery, and buying fit on ${merchant.business_name}.`,
    heading,
    summaryVerdict: `${brandCandidate.leftBrand} and ${brandCandidate.rightBrand} both matter for ${categoryName.toLowerCase()} shoppers${countrySuffix}, but their active model counts and price positioning differ.`,
    keyDifferences,
    comparisonRows,
    faqItems: [
      {
        question: `Which brand is better for ${categoryName.toLowerCase()}${countrySuffix}, ${brandCandidate.leftBrand} or ${brandCandidate.rightBrand}?`,
        answer: `Use the comparison table to decide whether ${brandCandidate.leftBrand}'s catalog depth or ${brandCandidate.rightBrand}'s price spread is the better fit for your budget and availability needs.`,
      },
      {
        question: `Does ${brandCandidate.leftBrand} have more options than ${brandCandidate.rightBrand}${countrySuffix}?`,
        answer: `${brandCandidate.leftBrand} currently has ${brandCandidate.leftBrandActiveCount} active models in this category, while ${brandCandidate.rightBrand} has ${brandCandidate.rightBrandActiveCount}.`,
      },
    ],
    breadcrumbItems,
    merchant,
    // Brand indexability is not graph-derived (curated-slug based), so it stays
    // in the cached core; only the guide links degrade per-request.
    isCanonicalSlugIndexable:
      brandCandidate.isIndexable && isCuratedCanonicalSlug,
    isCanonicalSlugCurated: isCuratedCanonicalSlug,
    leftBrand: brandCandidate.leftBrand,
    rightBrand: brandCandidate.rightBrand,
    overlay: {
      kind: 'brand',
      storeUrl,
      guideContext: supportedClusterCategory
        ? {
            pageKind: 'compare',
            categorySlug: supportedClusterCategory,
            brands: [brandCandidate.leftBrand, brandCandidate.rightBrand],
          }
        : null,
    },
  };
}
