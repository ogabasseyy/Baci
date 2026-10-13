import { buildStoreUrl } from '@/lib/store-url';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { buildBrandCompareCandidate } from './compare-eligibility';
import { parseCompareSlug } from './compare-slugs';
import {
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT,
  getCachedCompareCategoryInventory,
} from './get-cached-compare-category-inventory';
import { getCachedCompareMerchantByIdentifier } from './get-cached-compare-merchant';
import { getCachedMaintainedCompareRouteManifest } from './get-cached-maintained-compare-route-manifest';

/**
 * The proxy may emit a hard 404 only for `missing`. `unknown` is deliberately
 * separate from absence: a timeout, draft storefront, empty/truncated
 * inventory, or any loader exception must fall through to the App Router.
 */
export type ComparePageStatusResolution =
  | { kind: 'missing' }
  | { kind: 'renderable'; merchantId: string }
  | { kind: 'unknown' };

/**
 * Resolve the route-level existence contract for a comparison URL without
 * hydrating product details. This is the single status read model used by the
 * authenticated internal preflight endpoint. The page loader remains the
 * source of full content, but its route approval is the same bounded inventory
 * + maintained-manifest decision below.
 *
 * No catch belongs here. A thrown data/cache failure is a genuine uncertainty
 * and the internal route maps it to `unknown`; keeping the throw visible here
 * prevents callers from accidentally treating an infrastructure failure as a
 * real missing comparison.
 */
export async function resolveComparePageStatus(input: {
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
}): Promise<ComparePageStatusResolution> {
  const merchant = await getCachedCompareMerchantByIdentifier(
    input.merchantSlug
  );

  // Unknown or unpublished storefronts still have a layout-owned 200 shell in
  // production. The proxy must not pre-empt that shell with a hard 404.
  if (
    !merchant ||
    (!merchant.is_published && process.env.NODE_ENV !== 'development')
  ) {
    return { kind: 'unknown' };
  }

  const categorySafety = evaluateStorefrontSlugSafety(input.categorySlug);
  if (!categorySafety.safe) {
    return { kind: 'unknown' };
  }

  const parsed = parseCompareSlug(input.comparisonSlug);
  if (!parsed) {
    return { kind: 'missing' };
  }

  if (
    !evaluateStorefrontSlugSafety(parsed.leftKey).safe ||
    !evaluateStorefrontSlugSafety(parsed.rightKey).safe
  ) {
    return { kind: 'unknown' };
  }

  const inventory = await getCachedCompareCategoryInventory(
    merchant.id,
    input.categorySlug
  );

  // Collection routes do not have a compare page. An empty ordinary inventory
  // is intentionally ambiguous: it may be a newly published catalog, a stale
  // local cache, or a category query in transition. A full bounded window is
  // also ambiguous because the requested products may sit beyond the window.
  if (inventory.isCollection) {
    return { kind: 'missing' };
  }
  if (
    inventory.products.length === 0 ||
    inventory.products.length >= COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT
  ) {
    return { kind: 'unknown' };
  }

  const leftProduct = inventory.products.find(
    (product) => product.slug === parsed.leftKey
  );
  const rightProduct = inventory.products.find(
    (product) => product.slug === parsed.rightKey
  );

  if (leftProduct && rightProduct) {
    // Reuse the page's maintained-route manifest instead of duplicating the
    // curated/graph/anchored approval policy in the proxy architecture.
    const maintainedRouteManifest =
      await getCachedMaintainedCompareRouteManifest(
        merchant.id,
        input.categorySlug,
        input.merchantSlug,
        buildStoreUrl({
          slug: merchant.slug,
          custom_domain: merchant.custom_domain ?? undefined,
        })
      );

    // The manifest is derived from the same local cache entry as the
    // inventory. A negative can therefore lag a newly maintained pair on
    // another instance; only a positive is safe to hard-status here.
    return maintainedRouteManifest.includes(parsed.canonicalSlug)
      ? { kind: 'renderable', merchantId: merchant.id }
      : { kind: 'unknown' };
  }

  // A product key missing from a non-empty local snapshot is ambiguous: the
  // local cache may lag a newly published product on another instance. Do not
  // turn that stale absence into a hard 404. Brand-vs-brand pages are the one
  // legitimate path where neither parsed key is a product slug, so preserve a
  // positive brand verdict while treating every other absence as unknown.
  const brandCandidate = buildBrandCompareCandidate({
    categorySlug: input.categorySlug,
    products: inventory.products,
  });

  return brandCandidate?.canonicalSlug === parsed.canonicalSlug
    ? { kind: 'renderable', merchantId: merchant.id }
    : { kind: 'unknown' };
}
