import type React from 'react';
import { GadgetPattern } from './GadgetPattern';
import { HeroDesktopGrid } from './hero-desktop-grid';
import { HeroMobileCarousel } from './hero-mobile-carousel';
import { HeroUtilityPanel } from './hero-utility-panel';
import type { LaunchProductSlide } from './LaunchCarousel';
import { OgabasseyEmptyMobileHero } from './ogabassey-empty-mobile-hero';

interface HeroProps {
  /** Skip the mobile product carousel when the static parent already committed
   *  a brand-text LCP hero. Desktop grid is unchanged. */
  omitMobileCarousel?: boolean;
  /** Launch products (pinned A27/Power 80, then newest), pre-selected upstream.
   *  Drives both the mobile carousel and the desktop grid; each card deep-links
   *  to its PDP. Server-rendered so the links are crawlable; the first image of
   *  each viewport is the eager LCP element. An empty, published feed keeps the
   *  same viewport geometry with the baked product-agnostic banner. */
  slides: LaunchProductSlide[];
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
  omitMobileCarousel = false,
  slides,
}) => {
  return (
    <div className="w-full bg-store-background relative">
      {omitMobileCarousel ? null : (
        <h1 className="sr-only">
          OgaBassey - Buy Phones, Laptops, Gaming Consoles & More. Pay Later in
          Nigeria
        </h1>
      )}

      {omitMobileCarousel ? null : (
        <div
          id="hero-bg-extension"
          className="absolute top-0 left-0 right-0 h-28 overflow-hidden bg-[var(--ogabassey-shell-background)] z-0 md:hidden"
          data-ogabassey-mobile-hero-bg-extension="true"
          aria-hidden="true"
        >
          <GadgetPattern opacity={0.1} />
        </div>
      )}

      <section className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 pt-4 md:pt-6 flex flex-col">
        {slides.length > 0 ? (
          <>
            {omitMobileCarousel ? null : (
              <HeroMobileCarousel slides={slides} />
            )}
            <HeroDesktopGrid slides={slides} />
          </>
        ) : (
          <HeroEmptyGeometry />
        )}
      </section>

      <HeroUtilityPanel />
    </div>
  );
};
