import {
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from '@/config/ogabassey-home-hero-same-origin';
import { ogabasseyHomeHeroResourceHintProjection } from '@/lib/ogabassey-home-hero-resource-hint-projection';
import { resolveOgabasseyHomeHeroSnapshot } from '@/lib/ogabassey-home-hero-snapshot';

/**
 * Scanner-visible twin of the react-dom `preload()` in
 * `preloadOgabasseyHomeHeroResources`.
 *
 * The `preload()` hint travels as a flight `:HL` row, so the browser can only
 * act on it after client JS processes the flight stream — while the hero
 * `<picture>` itself streams much later in the document. A literal `<link>`
 * is discoverable by the preload scanner during HTML parse instead. React
 * hoists it to the document head, so it never precedes the critical-shell
 * host node in the body (see the PPR resume note in
 * `ogabassey-pdp-product-resource-hints.ts`).
 *
 * Attributes come from the shared projection, so this can never diverge from
 * the flight hint or the rendered `<picture>` (same builders, same tiers).
 * Renders nothing for non-CDN/blank sources — fail-open like `preload()`.
 */
export function OgabasseyHomeHeroPreloadLink({
  src,
}: {
  src: string | null | undefined;
}) {
  // Same-origin snapshot twin, resolved from the static manifest (no backend
  // reads, so the first-flush committed slot keeps its streaming constraint).
  // Applies only when the manifest holds this exact src — rotated content
  // falls through to the CDN projection below.
  const snapshot = resolveOgabasseyHomeHeroSnapshot(
    OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
    src
  );
  if (snapshot) {
    return (
      <link
        rel="preload"
        as="image"
        href={snapshot.href}
        imageSrcSet={snapshot.srcSet}
        imageSizes={MOBILE_HERO_IMAGE_SIZES}
        media={MOBILE_HERO_SOURCE_MEDIA}
        fetchPriority="high"
        type="image/avif"
        data-ogabassey-home-hero-preload="true"
      />
    );
  }
  const projection = ogabasseyHomeHeroResourceHintProjection.build(src);
  if (!projection) {
    return null;
  }

  return (
    <link
      rel="preload"
      as="image"
      href={projection.href}
      imageSrcSet={projection.imageSrcSet}
      imageSizes={projection.imageSizes}
      media={projection.media}
      fetchPriority="high"
      {...(projection.type ? { type: projection.type } : {})}
      data-ogabassey-home-hero-preload="true"
    />
  );
}
