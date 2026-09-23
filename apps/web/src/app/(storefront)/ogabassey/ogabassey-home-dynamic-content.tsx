import { Suspense } from 'react';
import { buildMerchantAnalyticsSettings } from '@/components/analytics/analytics-merchant-settings';
import { AnalyticsPixelProvider } from '@/components/analytics/analytics-pixel-provider';
import { getStorefrontNavigationCategories } from '@/lib/cached-categories';
import {
  getCachedStorefrontHomeProducts,
  type getRequestScopedMerchant,
} from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { OgabasseyHomeDiscoverySection } from './ogabassey-home-discovery-section';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';
import { OgabasseyHomeProductSection } from './ogabassey-home-product-section';

type OgabasseyMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;

/**
 * Geometry reserve for the product section while the home-product feed
 * resolves. The feed is usually the fastest leg (cached), so this rarely
 * shows — but when it loses the race, the grid, strip-ad slot, and cards
 * insert at zero height and shift everything below. Sized to the median
 * full 8-card mobile grid (section header ~90 + 4 rows of square-media
 * cards ~270 each + load-more row ~110 ≈ 1200): a full catalog swaps
 * near-exact, which is the common case. An empty catalog over-reserves
 * (accepted: rare, and the alternative — no reserve — shifts the common
 * case by the full section height instead). Desktop grids run slightly
 * shorter; tall desktop viewports absorb the difference.
 */
const PRODUCT_RESERVE_MIN_HEIGHT_CLASS = 'min-h-[1200px]';

/**
 * Geometry reserve for the discovery section while its enrichment legs
 * resolve. Mirrors the section wrapper so the streamed card replaces
 * same-footprint space instead of pushing a viewport-visible footer down
 * (a CLS shift when the product feed wins the race on a short catalog).
 * Sized to the median heading + category-pills block (~280: card padding
 * and heading plus ~4 wrapping pill rows): empty catalogs (~104px of card)
 * over-reserve, and extreme full catalogs (20 pills + 24 links ≈ 980px)
 * under-reserve — both tails are rare, and the median-minimizing height
 * keeps the common case near-exact. A full catalog also implies a long
 * product grid above, which keeps the residual insertion below the fold.
 */
const DISCOVERY_RESERVE_MIN_HEIGHT_CLASS = 'min-h-[280px]';

interface OgabasseyHomeDynamicContentProps {
  merchant: OgabasseyMerchant;
  pathPrefix: string;
}

/**
 * Below-fold homepage content, split into independently-streaming halves.
 *
 * Every leg starts here without awaiting (OgaBassey surfaces the most
 * recently updated devices first; smartphones are still pinned to the front
 * downstream via prioritizeSmartphoneProducts). Each Suspense boundary below
 * flushes the moment its own inputs resolve, so a slow category or launch
 * leg can no longer hold the SEO-critical product grid out of the streamed
 * HTML — the grid needs only the home-product feed, while the discovery
 * links and JSON-LD wait for the enrichment legs. Crawlers still receive the
 * fully rendered page. Both boundaries reserve median geometry (product
 * grid, discovery card) instead of null fallbacks, so whichever leg loses
 * the race inserts near-exact instead of shifting a viewport-visible
 * footer. No spinners below the fold — reserves are empty, aria-hidden
 * space only.
 */
export function OgabasseyHomeDynamicContent({
  merchant,
  pathPrefix,
}: OgabasseyHomeDynamicContentProps) {
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant);
  const productsPromise = getCachedStorefrontHomeProducts(
    merchant.id,
    'recent'
  );
  const categoriesPromise = getStorefrontNavigationCategories(merchant.id);
  // JSON-LD coverage only. loadOgabasseyLaunchProducts is best-effort (never
  // rejects), so a launch feed failure degrades to empty schema coverage
  // instead of failing the page.
  const launchProductsPromise = loadOgabasseyLaunchProducts(
    merchant.id,
    merchantCurrency
  );

  return (
    <>
      <AnalyticsPixelProvider
        merchant={buildMerchantAnalyticsSettings(merchant)}
      />
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="ogabassey-home-products"
            data-ogabassey-product-reserve="true"
          >
            <div className={PRODUCT_RESERVE_MIN_HEIGHT_CLASS} />
          </div>
        }
      >
        <OgabasseyHomeProductSection
          merchant={merchant}
          pathPrefix={pathPrefix}
          productsPromise={productsPromise}
        />
      </Suspense>
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="mx-auto mt-8 max-w-[1400px] px-4 md:px-6"
            data-ogabassey-discovery-reserve="true"
          >
            <div className={DISCOVERY_RESERVE_MIN_HEIGHT_CLASS} />
          </div>
        }
      >
        <OgabasseyHomeDiscoverySection
          categoriesPromise={categoriesPromise}
          launchProductsPromise={launchProductsPromise}
          merchant={merchant}
          pathPrefix={pathPrefix}
          productsPromise={productsPromise}
        />
      </Suspense>
    </>
  );
}
