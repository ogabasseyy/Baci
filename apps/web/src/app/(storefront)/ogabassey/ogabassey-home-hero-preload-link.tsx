import { ogabasseyHomeHeroResourceHintProjection } from '@/lib/ogabassey-home-hero-resource-hint-projection';

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
