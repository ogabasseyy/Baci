// Template preview
import { LAUNCH_CAROUSEL_LIMIT } from '@baci/shared/storefront/launch-carousel';
import type React from 'react';
import { Suspense } from 'react';
import { normalizeRouteBasePath } from '@/lib/routes';
import { buildLaunchSlides } from '../components/build-launch-slides';
import { DeferredAdUnit } from '../components/deferred-ad-unit';
import { HeroUtilityPanelGate } from '../components/hero-utility-panel-gate';
import { HeroUtilityPanelStatic } from '../components/hero-utility-panel-static';
import { HomeProductGridGate } from '../components/home-product-grid-gate';
import { HomeProductGridStaticFallback } from '../components/home-product-grid-static-fallback';
import { OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY } from '../components/home-section-reserve-geometry';
import { HOMEPAGE_STRIP_AD_BOOT_DELAY_MS } from '../config/ads';
import { Hero } from '../redesign/access-home-hero';
import { OwnershipSections } from '../redesign/ownership-sections';
import type { Product } from '../types';

// Define the expected props
interface HomePageProps {
  basePath?: string;
  storeSlug?: string;
  products?: Product[];
  /** Newly-released / pinned launch devices, newest-first, pre-selected upstream. */
  launchProducts?: Product[];
  categories?: { name: string; slug: string }[];
  renderHero?: boolean;
}

export const OgabasseyHomePage: React.FC<HomePageProps> = ({
  basePath,
  storeSlug,
  products,
  launchProducts,
  renderHero = true,
}) => {
  const routeBasePath = normalizeRouteBasePath(
    basePath ?? (storeSlug ? `/${storeSlug}` : '')
  );
  // Prefer the upstream-selected launch products (pinned + newest); fall back to
  // the home product feed so callers that don't pass `launchProducts` (e.g. the
  // generic storefront renderer) still render a product carousel rather than an
  // empty slot now that the old promo banner is gone.
  const launchSlides = renderHero
    ? buildLaunchSlides(launchProducts ?? products ?? [], routeBasePath).slice(
        0,
        LAUNCH_CAROUSEL_LIMIT
      )
    : [];

  return (
    <>
      {/* Mission-led hero reuses the published first product and LCP image descriptor. */}
      {renderHero && <Hero basePath={routeBasePath} slides={launchSlides} />}

      {/* Suspense boundary keeps the featured-products client gate chunks out
          of <head> (~31 KB JS saved from the critical path). An explicit
          1200px inline-styled fallback is required on <Suspense> because Fizz
          suspends the client gate while its RSC Flight props stream; a bare
          <Suspense> without a fallback collapses the outer 1200px product
          reserve to 0px mid-stream and pulls the discovery section into the
          mobile viewport for a 0.11 layout shift. */}
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="ogabassey-home-products"
            data-ogabassey-grid-gate-reserve="true"
          >
            <div
              className={
                OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.product.minHeightClass
              }
              style={OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.product.style}
            />
          </div>
        }
      >
        <HomeProductGridGate
          basePath={routeBasePath}
          storeSlug={storeSlug}
          products={products}
          initialDisplayCount={8}
          inlineAdBreakpoints={[12, 24]}
          fallback={
            <HomeProductGridStaticFallback
              basePath={routeBasePath}
              products={products}
              initialDisplayCount={8}
            />
          }
        />
      </Suspense>
      <OwnershipSections basePath={routeBasePath} />
      <Suspense fallback={<HeroUtilityPanelStatic />}>
        <HeroUtilityPanelGate fallback={<HeroUtilityPanelStatic />} />
      </Suspense>
      {/* Ad Placement: Homepage Strip */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4">
        <DeferredAdUnit
          activateOnInteraction
          placementKey="HOMEPAGE_STRIP"
          bootDelayMs={HOMEPAGE_STRIP_AD_BOOT_DELAY_MS}
          timeoutMs={0}
        />
      </div>
    </>
  );
};
