import { getOgabasseyImageFormatProps } from '@/lib/ogabassey-image-format-sources';
import { HOME_PRODUCT_GRID_CARD_IMAGE_SIZES } from './product-grid-image-sizes';

/**
 * Server-rendered twin of the interactive card's `CdnFormatImage`: the same
 * `getImageProps` inputs (src, fill, shared sizes ladder, lazy, low
 * priority) through the same per-format helper, emitting the same
 * `<picture>` + AVIF `<source>` + `<img>` DOM. The browser therefore picks
 * byte-identical candidates before the gate swap and after, so the
 * below-fold product image is fetched once and served from cache —
 * the previous hand-rolled jpeg `<img>` used a different URL than the
 * card's AVIF tier and caused a second fetch on swap.
 *
 * Absolute fill mirrors CdnFormatImage `fill` (no CLS). Non-CDN sources
 * have no AVIF tier and render the same plain `<img>` the card renders.
 *
 * Deliberately zero-JS (no 'use client'): AVIF-tier recovery is delegated
 * to the already-client `HomeProductGridGate` via a capture-phase error
 * listener scoped by `data-avif-recover`. Giving this module its own
 * client boundary would pull it and the format-sources graph into the
 * initial client payload just to cover a rare AVIF-transform failure.
 */
export function HomeProductGridFallbackImage({
  alt,
  src,
}: {
  alt: string;
  src: string;
}) {
  const { avifSource, imgProps } = getOgabasseyImageFormatProps({
    alt,
    fetchPriority: 'low',
    fill: true,
    loading: 'lazy',
    sizes: HOME_PRODUCT_GRID_CARD_IMAGE_SIZES,
    src,
  });

  // biome-ignore lint/performance/noImgElement: intentional — per-format
  // <picture> tiers require a raw <img>; props come from getImageProps so
  // this stays next/image-equivalent, matching CdnFormatImage.
  const img = (
    <img
      {...imgProps}
      alt={alt}
      className="ogabassey-home-product-card__image"
      data-avif-recover=""
      decoding="async"
      loading="lazy"
      style={{
        ...imgProps.style,
        height: '100%',
        inset: 0,
        position: 'absolute',
        width: '100%',
      }}
    />
  );

  if (!avifSource) {
    return img;
  }

  return (
    <picture style={{ display: 'contents' }}>
      <source
        sizes={avifSource.sizes}
        srcSet={avifSource.srcSet}
        type="image/avif"
      />
      {img}
    </picture>
  );
}
