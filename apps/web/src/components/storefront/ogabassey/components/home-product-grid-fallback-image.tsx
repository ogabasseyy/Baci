import { getOgabasseyImageFormatProps } from '@/lib/ogabassey-image-format-sources';
import { HOME_PRODUCT_GRID_CARD_IMAGE_SIZES } from './product-grid-image-sizes';

/**
 * Server-rendered twin of the interactive card's image: the same
 * `getImageProps` inputs (src, fill, shared sizes ladder, lazy, low
 * priority) through the same per-format helper, emitting the same
 * `<img>` URL the card's JPEG tier uses — so the below-fold product
 * image is already cached when the gate swaps.
 *
 * Absolute fill mirrors CdnFormatImage `fill` (no CLS).
 *
 * Deliberately a plain `<img>` with NO AVIF `<source>` tier and zero JS
 * (no 'use client'): an AVIF tier would need recovery for failed
 * transforms, and no client recovery can cover failures that fire before
 * hydration — or no-JS readers at all, for whom this SSR fallback is the
 * entire product image. A failed AVIF source would leave those cards
 * permanently broken; the JPEG `<img>` always renders. After the swap the
 * grid keeps this JPEG tier for the fallback-rendered slice (no
 * format-changing refetch); load-more cards mount fresh with the AVIF
 * tier and client recovery.
 */
export function HomeProductGridFallbackImage({
  alt,
  src,
}: {
  alt: string;
  src: string;
}) {
  const { imgProps } = getOgabasseyImageFormatProps({
    alt,
    fetchPriority: 'low',
    fill: true,
    loading: 'lazy',
    sizes: HOME_PRODUCT_GRID_CARD_IMAGE_SIZES,
    src,
  });

  // biome-ignore lint/performance/noImgElement: intentional — props come
  // from getImageProps so this stays next/image-equivalent, matching
  // CdnFormatImage's JPEG tier.
  return (
    <img
      {...imgProps}
      alt={alt}
      className="ogabassey-home-product-card__image"
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
}
