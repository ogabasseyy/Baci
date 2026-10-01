import { HeroMobileControlsSkeleton } from '@/components/storefront/ogabassey/components/hero-mobile-controls-skeleton';
import {
  HERO_MOBILE_PANEL_CLASSES,
  HERO_MOBILE_WRAPPER_CLASSES,
} from '@/components/storefront/ogabassey/components/hero-mobile-geometry';
import { HeroUtilityPanelStatic } from '@/components/storefront/ogabassey/components/hero-utility-panel-static';

/**
 * Reserved-geometry stand-in for the homepage Hero while the request-scoped
 * hero streams in (cold hero-shell cache or a merchant-identifier mismatch).
 *
 * The previous `fallback={null}` boundaries left the hero area at zero height
 * until the recovery feed resolved, so the streamed Hero pushed every section
 * below it down — the dominant lab-reproducible contributor to the homepage's
 * field CLS. This fallback mirrors the streamed Hero's first-frame geometry
 * exactly (shared geometry classes, same section wrapper):
 *   - mobile: h-48 panel + the 52px multi-slide controls row + utility panel
 *   - desktop: the same skeleton grid Hero renders for an empty feed
 * so stream-in replaces same-sized boxes and moves nothing.
 *
 * Tradeoffs, documented so they are not "fixed" back:
 *   - The controls row is reserved unconditionally (multi-slide is the
 *     common case). The resolved zero/single-slide heroes keep the same
 *     slot invisibly via the shared skeleton, so even degenerate swaps
 *     move nothing.
 *   - No product art or copy: feed degradation must not invent shopping UI,
 *     and an inline banner here would bloat the stream for a transient frame.
 *   - The zero-JS HeroUtilityPanelStatic renders (not a sized div) because
 *     the panel's desktop-row height has no static token; the static twin
 *     carries the exact boxes with HTML bytes only, keeping the interactive
 *     panel's client JS out of the fallback path entirely.
 *   - The static panel renders `invisible` (visibility:hidden): this
 *     fallback shows while the request-scoped publication check is still
 *     pending, so its copy/controls must not become visible shopping UI for
 *     an unpublished store, a tenant mismatch, or a slow lookup. Visibility
 *     keeps the geometry (no CLS delta) while painting nothing; `inert` +
 *     `aria-hidden` already remove it from interaction and assistive tech.
 */
export function OgabasseyHomeHeroReserveFallback({
  omitMobileCarousel = false,
}: {
  omitMobileCarousel?: boolean;
}) {
  return (
    // `inert` (React 19 boolean prop) makes the transient frame
    // non-interactive: the utility panel's buttons render for geometry only
    // and must not open purchase flows before the publication guard resolves
    // (the outer boundary shows this fallback pre-guard). `aria-hidden`
    // keeps it out of the accessibility tree; crawlers see geometry divs
    // with no links or product claims.
    <div
      aria-hidden="true"
      data-ogabassey-home-hero-reserve-fallback="true"
      inert
    >
      <section className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 pt-4 md:pt-6 flex flex-col">
        {omitMobileCarousel ? null : (
          <div
            className={HERO_MOBILE_WRAPPER_CLASSES}
            data-ogabassey-home-hero-reserve-mobile="true"
          >
            <div className={HERO_MOBILE_PANEL_CLASSES} />
            <HeroMobileControlsSkeleton />
          </div>
        )}
        <div
          aria-hidden="true"
          className="hidden md:grid grid-cols-1 lg:grid-cols-5 gap-4 h-auto lg:h-[540px] order-2"
        >
          <div className="lg:col-span-3 h-[400px] lg:h-full rounded-2xl ring-1 ring-store-border/70 shadow-lg bg-store-secondary" />
          <div className="hidden lg:flex flex-col gap-4 h-full lg:col-span-2">
            <div className="flex-1 rounded-2xl shadow-lg ring-1 ring-store-border/70 bg-store-secondary" />
            <div className="flex-1 rounded-2xl shadow-lg ring-1 ring-store-border/70 bg-store-secondary" />
          </div>
        </div>
      </section>

      <div
        className="invisible"
        data-ogabassey-home-hero-reserve-utility="true"
      >
        <HeroUtilityPanelStatic />
      </div>
    </div>
  );
}
