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
 * fully rendered page. Fallbacks stay null to match the outer boundary in
 * the request-scoped page content (no spinners below the fold).
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
      <Suspense fallback={null}>
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
