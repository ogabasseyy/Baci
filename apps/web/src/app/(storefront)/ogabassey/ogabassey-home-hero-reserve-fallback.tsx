import { Hero } from '@/components/storefront/ogabassey/redesign/access-home-hero';

/** Identical brand typography and geometry without product data or links.
 * Invisible and inert until the existing tenant/publication guard resolves. */
export function OgabasseyHomeHeroReserveFallback({
  omitMobileCarousel = false,
}: {
  omitMobileCarousel?: boolean;
}) {
  return (
    <div
      data-ogabassey-home-hero-reserve-fallback="true"
      aria-hidden="true"
      inert
    >
      <Hero
        slides={[]}
        omitDocumentHeading
        omitMobileCarousel={omitMobileCarousel}
        reserve
      />
    </div>
  );
}
