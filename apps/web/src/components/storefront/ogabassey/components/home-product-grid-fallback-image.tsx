'use client';

import { useState } from 'react';
import type { ReactEventHandler } from 'react';
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
 * AVIF recovery mirrors CdnFormatImage: when an AVIF-capable browser
 * selects the AVIF tier but the transform fails, `<picture>` would never
 * retry the JPEG `<img>` — the card would stay broken until the deferred
 * grid mounts. The `<img>` error handler drops the failed AVIF `<source>`
 * so the already-in-tree JPEG fallback renders, exactly like the twin.
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
  const [failedAvifSrcSet, setFailedAvifSrcSet] = useState<string | null>(
    null
  );
  const isAvifDisabled =
    avifSource !== null && failedAvifSrcSet === avifSource.srcSet;

  const handleError: ReactEventHandler<HTMLImageElement> = (event) => {
    const img = event.currentTarget;
    // Only the AVIF tier's own failure disables that tier: `currentSrc`
    // names the tier the browser actually selected, and AVIF candidate
    // URLs are the only ones carrying `format=avif`. A JPEG fallback
    // failure (or an already-disabled tier) has no further fallback here.
    if (avifSource && img.currentSrc.includes('format=avif')) {
      setFailedAvifSrcSet(avifSource.srcSet);
    }
  };

  // biome-ignore lint/performance/noImgElement: intentional — per-format
  // <picture> tiers require a raw <img>; props come from getImageProps so
  // this stays next/image-equivalent, matching CdnFormatImage.
  const img = (
    <img
      {...imgProps}
      alt={alt}
      className="ogabassey-home-product-card__image"
      decoding="async"
      loading="lazy"
      onError={handleError}
      style={{
        ...imgProps.style,
        height: '100%',
        inset: 0,
        position: 'absolute',
        width: '100%',
      }}
    />
  );

  if (!avifSource || isAvifDisabled) {
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
