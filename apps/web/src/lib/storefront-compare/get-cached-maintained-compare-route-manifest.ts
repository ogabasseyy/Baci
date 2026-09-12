import { cacheLife, cacheTag } from 'next/cache';
import { buildCuratedCompareSlugSet } from './compare-indexability-policy';
import { getCachedCompareCategoryInventory } from './get-cached-compare-category-inventory';
import { getMaintainedCompareRouteManifest } from './get-maintained-compare-route-manifest';
import {
  getPublishedStorefrontComparisonRevision,
  type StorefrontComparisonRevision,
} from './get-published-storefront-comparison-revision';

interface MaintainedManifestInput {
  categorySlug: string;
  merchantId: string;
  storeSlug: string;
  storeUrl: string;
}

function tagMaintainedManifest(input: MaintainedManifestInput): void {
  try {
    cacheLife('products');
    cacheTag(
      `products-${input.merchantId}`,
      `categories-${input.merchantId}`,
      `features-${input.merchantId}`,
      'merchants',
      `merchant-id-${input.merchantId}`,
      `merchant-${input.storeSlug}`
    );
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }
}

async function buildMaintainedCompareRouteManifest(
  input: MaintainedManifestInput,
  comparisonRevision?: StorefrontComparisonRevision
): Promise<string[]> {
  const inventory = await getCachedCompareCategoryInventory(
    input.merchantId,
    input.categorySlug,
    comparisonRevision
  );

  if (inventory.isCollection) return [];

  const categoryName = inventory.fallbackName || input.categorySlug;
  const curatedSlugs = buildCuratedCompareSlugSet({
    storeUrl: input.storeUrl,
    categorySlug: input.categorySlug,
    categoryName,
    products: inventory.products,
  });

  return [
    ...getMaintainedCompareRouteManifest({
      storeUrl: input.storeUrl,
      categorySlug: input.categorySlug,
      categoryName,
      products: inventory.products,
      curatedSlugs,
    }),
  ];
}

async function getLocallyCachedMaintainedCompareRouteManifest(
  input: MaintainedManifestInput
): Promise<string[]> {
  'use cache';
  tagMaintainedManifest(input);
  return await buildMaintainedCompareRouteManifest(input);
}

async function getRevisionCachedMaintainedCompareRouteManifest(
  input: MaintainedManifestInput,
  comparisonRevision: StorefrontComparisonRevision
): Promise<string[]> {
  'use cache: remote';
  tagMaintainedManifest(input);
  return await buildMaintainedCompareRouteManifest(input, comparisonRevision);
}

/**
 * Shares maintained route computation only when every locally cached input is
 * keyed by a fresh, durable merchant revision. If that authority is unavailable
 * the local cache remains a fail-open performance fallback, never a shared
 * negative decision.
 */
export async function getCachedMaintainedCompareRouteManifest(
  merchantId: string,
  categorySlug: string,
  storeSlug: string,
  storeUrl: string
): Promise<string[]> {
  const input = { merchantId, categorySlug, storeSlug, storeUrl };

  let comparisonRevision: StorefrontComparisonRevision | null;
  try {
    comparisonRevision =
      await getPublishedStorefrontComparisonRevision(merchantId);
  } catch {
    // Fall through to the isolated local cache. A failed revision read cannot
    // be represented as a shared "not maintained" cache entry.
    return await getLocallyCachedMaintainedCompareRouteManifest(input);
  }

  if (comparisonRevision) {
    return await getRevisionCachedMaintainedCompareRouteManifest(
      input,
      comparisonRevision
    );
  }

  return await getLocallyCachedMaintainedCompareRouteManifest(input);
}
