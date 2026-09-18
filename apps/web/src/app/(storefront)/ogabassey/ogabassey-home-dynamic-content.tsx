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
 * Geometry reserve for the discovery section while its enrichment legs
 * resolve. Mirrors the section wrapper so the streamed card replaces
 * same-footprint space instead of pushing a viewport-visible footer down
 * (a CLS shift when the product feed wins the race on a short catalog).
 * Sized to the heading + category-pills block that always renders; a full
 * 24-link list is taller, but then the product grid above is long enough
 * to keep the insertion below the fold. Approximate by design — it bounds
 * the shift, and the empty-catalog case over-reserves slightly.
 */
const DISCOVERY_RESERVE_MIN_HEIGHT_CLASS = 'min-h-[180px]';

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
 * fully rendered page. The product boundary keeps a null fallback to match
 * the outer boundary (no spinners below the fold); the discovery boundary
 * reserves its card geometry instead, so independent streaming does not
 * shift a viewport-visible footer when it inserts.
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
      <Suspense fallback={null}>
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
