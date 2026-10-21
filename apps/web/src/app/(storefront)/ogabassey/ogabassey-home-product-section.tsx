import { mapHomeProductsToTemplateProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-product-adapter';
import { createOgabasseyHomeProductFeed } from '@/components/storefront/ogabassey/home-product-feed';
import { OgabasseyHomePage } from '@/components/storefront/ogabassey/pages/home';
import type {
  getRequestScopedMerchant,
  StorefrontHomeProduct,
} from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

type OgabasseyMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;

export interface OgabasseyHomeProductSectionProps {
  merchant: OgabasseyMerchant;
  pathPrefix: string;
  /**
   * Started (not awaited) by the parent alongside the category/launch legs.
   * Awaiting it here — inside its own Suspense boundary — lets the
   * SEO-critical product grid stream the moment the home-product feed
   * resolves instead of waiting for the slower category/launch legs.
   */
  productsPromise: Promise<StorefrontHomeProduct[]>;
}

/**
 * Below-fold product grid for the OgaBassey homepage. Awaits only the
 * home-product feed: the category navigation and launch-product legs stay in
 * the sibling discovery section, so a slow category query can no longer hold
 * the product links/names/prices out of the streamed HTML.
 *
 * `launchProducts`/`categories` are intentionally not threaded through: with
 * `renderHero={false}` the grid ignores both (launch slides feed only the
 * Hero, which has its own streamed boundary). Re-thread them here if the grid
 * ever consumes either — otherwise this boundary would re-couple to the very
 * legs it exists to stream ahead of.
 */
export async function OgabasseyHomeProductSection({
  merchant,
  pathPrefix,
  productsPromise,
}: OgabasseyHomeProductSectionProps) {
  const startedAt = performance.now();
  const products = (await productsPromise) || [];
  // Yield after the product feed resolves so that when 'use cache' resolves
  // synchronously in memory during PPR resume or SSR, React's Fizz HTML stream
  // flushes the above-the-fold <Hero> shell and lets the browser paint FCP/LCP
  // (~42ms) before receiving ~57 KB of below-the-fold product card Flight data.
  const targetYieldMs = process.env.NODE_ENV === 'test' ? 0 : 75;
  const remainingYieldMs = Math.max(
    0,
    Math.ceil(targetYieldMs - (performance.now() - startedAt))
  );
  await new Promise<void>((resolve) => setTimeout(resolve, remainingYieldMs));
  const merchantProducts = mapHomeProductsToTemplateProducts(products);
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant);

  return (
    <OgabasseyHomePage
      basePath={pathPrefix}
      products={createOgabasseyHomeProductFeed(
        merchantProducts,
        merchantCurrency
      )}
      renderHero={false}
      storeSlug={merchant.slug}
    />
  );
}
