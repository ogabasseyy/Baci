import { OgabasseyHomeHeroReserveFallback } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-reserve-fallback';
import { HeroDesktopGrid } from './hero-desktop-grid';
import { HeroMobileControlsSkeleton } from './hero-mobile-controls-skeleton';
import {
  HERO_MOBILE_CTA_CLASSES,
  HERO_MOBILE_EYEBROW_CLASSES,
  HERO_MOBILE_IMAGE_COLUMN_CLASSES,
  HERO_MOBILE_PANEL_CLASSES,
  HERO_MOBILE_PRICE_CLASSES,
  HERO_MOBILE_SLIDE_GRID_CLASSES,
  HERO_MOBILE_TEXT_COLUMN_CLASSES,
  HERO_MOBILE_TITLE_CLASSES,
  HERO_MOBILE_WRAPPER_CLASSES,
} from './hero-mobile-geometry';
import { HeroUtilityPanelStatic } from './hero-utility-panel-static';
import type { LaunchProductSlide } from './LaunchCarousel';
import { MobileLcpHeroImage } from './mobile-lcp-hero-image';

export const HERO_DOCUMENT_HEADING =
  'OgaBassey - Buy Phones, Laptops, Gaming Consoles & More. Pay Later in Nigeria';

/**
 * First paint of an already-authorized Hero. This component never fetches or
 * resolves a tenant: it uses precisely the slides passed to the real carousel
 * after its caller's publication/tenant checks. Pure HTML avoids client-module
 * suspension. Native links remain usable before React resolves the carousel;
 * shared geometry and image selection prevent shifts and duplicate downloads.
 */
export function HeroStreamFallback({
  slides,
  omitMobileCarousel = false,
  prioritizeFirstImage = true,
  omitDocumentHeading = false,
}: {
  slides: LaunchProductSlide[];
  omitMobileCarousel?: boolean;
  prioritizeFirstImage?: boolean;
  omitDocumentHeading?: boolean;
}) {
  const first = slides[0];
  const heading = omitDocumentHeading ? null : (
    <h1 className="sr-only">{HERO_DOCUMENT_HEADING}</h1>
  );
  if (!first)
    return (
      <>
        {heading}
        <OgabasseyHomeHeroReserveFallback
          omitMobileCarousel={omitMobileCarousel}
        />
      </>
    );

  return (
    <div
      data-ogabassey-hero="true"
      data-ogabassey-hero-stream-fallback="true"
      className="w-full bg-store-background relative"
    >
      {heading}
      {!omitMobileCarousel && (
        <div
          className="absolute top-0 left-0 right-0 h-28 overflow-hidden bg-[var(--ogabassey-shell-background)] z-0 md:hidden"
          data-ogabassey-mobile-hero-bg-extension="true"
          aria-hidden="true"
        />
      )}
      <section className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 pt-4 md:pt-6 flex flex-col">
        {!omitMobileCarousel && (
          <div className={HERO_MOBILE_WRAPPER_CLASSES}>
            <div
              className={HERO_MOBILE_PANEL_CLASSES}
              data-ogabassey-mobile-hero-panel="true"
            >
              <div
                className={`${HERO_MOBILE_SLIDE_GRID_CLASSES} opacity-100 z-10`}
                role="group"
                aria-hidden="false"
              >
                <div className={HERO_MOBILE_TEXT_COLUMN_CLASSES}>
                  <span className={HERO_MOBILE_EYEBROW_CLASSES}>
                    Just launched
                  </span>
                  <h2 className={HERO_MOBILE_TITLE_CLASSES}>{first.name}</h2>
                  <p className={HERO_MOBILE_PRICE_CLASSES}>
                    {first.priceLabel}
                  </p>
                  <a className={HERO_MOBILE_CTA_CLASSES} href={first.href}>
                    {first.ctaLabel}
                  </a>
                </div>
                <div className={HERO_MOBILE_IMAGE_COLUMN_CLASSES}>
                  {prioritizeFirstImage && (
                    <MobileLcpHeroImage
                      alt={first.imageAlt}
                      imageFit="contain"
                      shouldPrioritizeImage
                      src={first.imageUrl}
                    />
                  )}
                </div>
              </div>
            </div>
            <HeroMobileControlsSkeleton />
          </div>
        )}
        <HeroDesktopGrid slides={slides} staticLinks />
      </section>
      <div aria-hidden="true">
        <HeroUtilityPanelStatic />
      </div>
    </div>
  );
}
