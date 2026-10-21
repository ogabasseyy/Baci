import type React from 'react';
import { Suspense } from 'react';
import { GadgetPattern } from './GadgetPattern';
import { HeroDesktopGrid } from './hero-desktop-grid';
import { HeroMobileCarousel } from './hero-mobile-carousel';
import { HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS } from './hero-mobile-geometry';
import { HeroUtilityPanelGate } from './hero-utility-panel-gate';
import { HeroUtilityPanelStatic } from './hero-utility-panel-static';
import type { LaunchProductSlide } from './LaunchCarousel';
import { OgabasseyEmptyMobileHero } from './ogabassey-empty-mobile-hero';

interface HeroProps {
  /** Skip the document H1 when a parent already committed one. */
  omitDocumentHeading?: boolean;
  /** Skip the mobile product carousel when the static parent already committed
   *  a brand-text LCP hero. Desktop grid is unchanged. */
  omitMobileCarousel?: boolean;
  /** Eager/high-priority first mobile image. Defaults off when the parent
   *  already committed a text LCP so the below-fold carousel cannot steal it. */
  prioritizeMobileHeroImage?: boolean;
  /** Launch products (pinned A27/Power 80, then newest), pre-selected upstream.
   *  Drives both the mobile carousel and the desktop grid; each card deep-links
   *  to its PDP. Server-rendered so the links are crawlable; the first image of
   *  each viewport is the eager LCP element. An empty, published feed keeps the
   *  same viewport geometry with the baked product-agnostic banner. */
  slides: LaunchProductSlide[];
}

function HeroUtilityPanelStreamReserve() {
  return (
    <div
      aria-hidden="true"
      className="w-full bg-store-background mt-3 md:mt-8 mb-6 border-y border-store-border md:py-5"
      data-ogabassey-hero-utility="true"
    >
      <div className="md:hidden px-4">
        <div
          className={`${HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS} bg-store-background rounded-3xl shadow-sm border border-store-border p-2`}
          data-ogabassey-mobile-utility-panel="true"
        />
      </div>
      <div className="hidden md:flex max-w-[1400px] mx-auto px-4 md:px-6 min-h-[92px] flex-row items-center justify-between" />
    </div>
  );
}

function HeroEmptyGeometry() {
  return (
    <>
      <div
        aria-hidden="true"
        className="md:hidden order-1"
        data-ogabassey-empty-mobile-hero="true"
      >
        <OgabasseyEmptyMobileHero />
      </div>
      <div
        aria-hidden="true"
        className="hidden md:grid grid-cols-1 lg:grid-cols-5 gap-4 h-auto lg:h-[540px] order-2"
        data-ogabassey-empty-desktop-hero="true"
      >
        <div className="lg:col-span-3 h-[400px] lg:h-full rounded-2xl ring-1 ring-store-border/70 shadow-lg bg-store-secondary" />
        <div className="hidden lg:flex flex-col gap-4 h-full lg:col-span-2">
          <div className="flex-1 rounded-2xl shadow-lg ring-1 ring-store-border/70 bg-store-secondary" />
          <div className="flex-1 rounded-2xl shadow-lg ring-1 ring-store-border/70 bg-store-secondary" />
        </div>
      </div>
    </>
  );
}

export const Hero: React.FC<HeroProps> = ({
  omitDocumentHeading = false,
  omitMobileCarousel = false,
  prioritizeMobileHeroImage,
  slides,
}) => {
  const shouldPrioritizeMobileHeroImage =
    prioritizeMobileHeroImage ?? !omitDocumentHeading;

  return (
    <Suspense fallback={null}>
      <div
        className="w-full bg-store-background relative"
        data-ogabassey-hero="true"
      >
        {omitDocumentHeading ? null : (
          <h1 className="sr-only">
            OgaBassey - Buy Phones, Laptops, Gaming Consoles & More. Pay Later
            in Nigeria
          </h1>
        )}

        {omitMobileCarousel ? null : (
          <Suspense fallback={null}>
            <div
              id="hero-bg-extension"
              className="absolute top-0 left-0 right-0 h-28 overflow-hidden bg-[var(--ogabassey-shell-background)] z-0 md:hidden"
              data-ogabassey-mobile-hero-bg-extension="true"
              aria-hidden="true"
            >
              <Suspense fallback={null}>
                <GadgetPattern opacity={0.1} />
              </Suspense>
            </div>
          </Suspense>
        )}

        <section className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 pt-4 md:pt-6 flex flex-col">
          {slides.length > 0 ? (
            <>
              {omitMobileCarousel ? null : (
                <HeroMobileCarousel
                  prioritizeFirstImage={shouldPrioritizeMobileHeroImage}
                  slides={slides}
                />
              )}
              <HeroDesktopGrid slides={slides} />
            </>
          ) : (
            <HeroEmptyGeometry />
          )}
        </section>

        <Suspense fallback={null}>
          <Suspense fallback={<HeroUtilityPanelStreamReserve />}>
            <HeroUtilityPanelGate fallback={<HeroUtilityPanelStatic />} />
          </Suspense>
        </Suspense>
      </div>
    </Suspense>
  );
};
