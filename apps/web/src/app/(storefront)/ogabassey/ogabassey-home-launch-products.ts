import {
  effectiveLaunchPins,
  LAUNCH_CAROUSEL_LIMIT,
  OGABASSEY_LAUNCH_PINS_SINCE,
  OGABASSEY_PINNED_LAUNCH_SLUGS,
  selectLaunchProducts,
} from '@baci/shared/storefront';
import { mapHomeProductsToTemplateProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-product-adapter';
import { mapStorefrontProductsToOgabasseyProducts } from '@/components/storefront/ogabassey/home-product-feed';
import type { Product } from '@/components/storefront/ogabassey/types';
import {
  getCachedStorefrontLaunchProducts,
  type StorefrontHomeProduct,
} from '@/lib/cached-data';
import { getCachedStorefrontProductsBySlugs } from '@/lib/cached-storefront-products-by-slugs';
import type { CurrencyConfig } from '@/lib/currency';
import { preferFirstPartyCdnLeadItem } from '@/lib/prefer-first-party-cdn-lead-item';

/** Newest-created first. ISO timestamps compare lexically by time; missing
 * timestamps sort last. Used only for the launch carousel so its order is
 * driven by product additions, not edits. `created_at` is optional/nullable in
 * the row type, so it is read defensively even though launch queries select it. */
export function sortByNewestCreated<T>(rows: readonly T[]): T[] {
  const createdAt = (row: T): string =>
    String((row as { created_at?: string | null }).created_at ?? '');
  return [...rows].sort((a, b) => {
    const first = createdAt(a);
    const second = createdAt(b);
    return first === second ? 0 : first > second ? -1 : 1;
  });
}

/**
 * Selects, orders, and formats the OgaBassey homepage launch carousel products,
 * applying configured launch pins, fresh-arrival promotion, and first-party CDN
 * lead preference for Slide 0.
 */
export function selectOgabasseyLaunchProducts({
  launchCandidateRows,
  pinnedProductRows,
  currency,
}: {
  launchCandidateRows: readonly StorefrontHomeProduct[];
  pinnedProductRows: readonly StorefrontHomeProduct[];
  /** Merchant display currency; defaults to NGN inside the price mapper. */
  currency?: CurrencyConfig;
}): Product[] {
  const pinnedProducts = mapHomeProductsToTemplateProducts([
    ...pinnedProductRows,
  ]);
  const carouselProducts = mapHomeProductsToTemplateProducts(
    sortByNewestCreated(launchCandidateRows)
  );
  const launchPins = effectiveLaunchPins(
    launchCandidateRows,
    OGABASSEY_PINNED_LAUNCH_SLUGS,
    OGABASSEY_LAUNCH_PINS_SINCE
  );
  const launchSubset = preferFirstPartyCdnLeadItem(
    selectLaunchProducts(
      [...pinnedProducts, ...carouselProducts].filter(
        (product) => Boolean(product.slug) && Boolean(product.image)
      ),
      { pinned: launchPins, limit: LAUNCH_CAROUSEL_LIMIT }
    ),
    (product) => product.image
  );

  // Launch items feed the server-built hero slides and home JSON-LD only —
  // they never cross the client boundary, and the schema builder needs the
  // untruncated description. Currency is threaded through so non-NGN merchants
  // format launch prices correctly, while descriptionMode stays 'full' to keep
  // the CollectionPage JSON-LD byte-identical.
  return mapStorefrontProductsToOgabasseyProducts(launchSubset, currency, {
    descriptionMode: 'full',
  });
}

/**
 * Best-effort: launch products are optional (they drive the hero carousel and
 * JSON-LD coverage), so a launch-feed failure must degrade to an empty list —
 * Hero falls back to its empty geometry — and never take down the awaiting hero
 * section or homepage. Both legs are caught so this function never rejects.
 */
export async function loadOgabasseyLaunchProducts(
  merchantId: string,
  currency?: CurrencyConfig
): Promise<Product[]> {
  const [launchCandidateRows, pinnedProductRows] = await Promise.all([
    getCachedStorefrontLaunchProducts(merchantId).catch((error) => {
      console.error('Failed to load launch candidate products', { error });
      return [];
    }),
    getCachedStorefrontProductsBySlugs(
      merchantId,
      OGABASSEY_PINNED_LAUNCH_SLUGS
    ).catch((error) => {
      console.error('Failed to load pinned launch products', { error });
      return [];
    }),
  ]);

  return selectOgabasseyLaunchProducts({
    launchCandidateRows: launchCandidateRows || [],
    pinnedProductRows: pinnedProductRows || [],
    currency,
  });
}
