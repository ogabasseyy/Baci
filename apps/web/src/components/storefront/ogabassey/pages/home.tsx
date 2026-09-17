// Template preview
import { LAUNCH_CAROUSEL_LIMIT } from '@baci/shared/storefront/launch-carousel';
import type React from 'react';
import { Suspense } from 'react';
import { normalizeRouteBasePath } from '@/lib/routes';
import type { Product } from '../types';
import { buildLaunchSlides } from '../components/build-launch-slides';
import { DeferredAdUnit } from '../components/deferred-ad-unit';
import { HomeProductGridGate } from '../components/home-product-grid-gate';
import { HomeProductGridStaticFallback } from '../components/home-product-grid-static-fallback';
import { Hero } from '../components/Hero';
import { HOMEPAGE_STRIP_AD_BOOT_DELAY_MS } from '../config/ads';

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
  const launchSlides = buildLaunchSlides(
    launchProducts ?? products ?? [],
    routeBasePath
  ).slice(0, LAUNCH_CAROUSEL_LIMIT);

  return (
    <>
      {/* Product-driven hero: the big slot + side cards surface real launch
          devices (pinned A27 / Power 80, then newest), each deep-linking to its
          PDP. Replaces the old hardcoded promo banner. The first hero image is
          the eager LCP element; see Hero/hero-desktop-grid. */}
      {renderHero && <Hero slides={launchSlides} />}

      {/* Ad Placement: Homepage Strip */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4">
        <DeferredAdUnit
          activateOnInteraction
          placementKey="HOMEPAGE_STRIP"
          bootDelayMs={HOMEPAGE_STRIP_AD_BOOT_DELAY_MS}
          timeoutMs={0}
        />
      </div>

      {/* Suspense boundary keeps the featured-products section non-blocking.
          The static fallback server-renders the product cards (links, names,
          prices) with zero JS; the interactive grid module loads only when
          the section approaches the viewport, keeping below-fold grid JS out
          of the initial bundle. */}
      <Suspense>
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
    </>
  );
};
