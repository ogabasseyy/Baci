'use client';

import { type ReactEventHandler, type Ref, useState } from 'react';
import { preload } from 'react-dom';
import { rewriteOgabasseyTransformUrlFormat } from '@/lib/ogabassey-cdn-image-url';
import {
  getOgabasseyImageFormatProps,
  type OgabasseyImageFormatPropsInput,
} from '@/lib/ogabassey-image-format-sources';

/**
 * Drop-in replacement for `next/image`'s `<Image>` on surfaces that render
 * OgaBassey CDN product/blog images.
 *
 * Renders a `<picture>` with an explicit `format=avif` source
 * (`type="image/avif"` — AVIF-capable browsers pick it, others skip it) and
 * a universally decodable png/jpeg `<img>` fallback. Per-format URLs give
 * each format its own Cloudflare cache key: the Free plan ignores
 * `Vary: Accept`, so the previous single `format=auto` URL served one warm
 * body (AVIF) to every client, handing non-AVIF browsers undecodable bytes
 * (probe-verified 2026-07-08).
 *
 * Non-CDN sources (Supabase-hosted merchants, placeholders) have no AVIF
 * tier and render exactly what `<Image>` rendered before: a single `<img>`
 * with unchanged props. The `<picture>` wrapper uses `display: contents` so
 * it generates no box — geometry is byte-for-byte the bare `<img>`'s,
 * including `fill` layouts where the img is absolutely positioned.
 *
 * `preload` parity: `<Image preload>` emits a react-dom `preload()` for its
 * srcset; `getImageProps` does not. This component restores that hint —
 * targeting the AVIF tier (with `type="image/avif"` so non-AVIF browsers
 * skip it instead of double-fetching) and the plain srcset for non-CDN
 * sources. Dedicated resource-hint modules that preload the same AVIF tier
 * resolve to the same candidate URL, so the browser still fetches once.
 *
 * `onError`/`onLoad` are attached to the rendered `<img>` directly instead
 * of being routed through `getImageProps`, whose contract only covers
 * attribute computation.
 */

const PICTURE_STYLE = { display: 'contents' } as const;

export type CdnFormatImageProps = Omit<
  OgabasseyImageFormatPropsInput,
  'onError' | 'onLoad'
> & {
  onError?: ReactEventHandler<HTMLImageElement>;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  // Forwarded to the underlying <img>. Callers that gate visibility on load
  // state need it to detect images that were already `complete` before
  // hydration attached onLoad (SSR'd native <img> + warm browser cache).
  ref?: Ref<HTMLImageElement>;
  /**
   * Render the universal `<img>` tier only, skipping the AVIF `<source>`
   * (and its preload). For surfaces swapped in over an already-fetched
   * JPEG — e.g. the homepage grid after its AVIF-free static fallback —
   * so the browser reuses the cached bytes instead of downloading the
   * same image again in another format.
   */
  disableAvifTier?: boolean;
};

export function CdnFormatImage({
  onError,
  onLoad,
  ref,
  disableAvifTier = false,
  ...input
}: CdnFormatImageProps) {
  const { avifSource: computedAvifSource, imgProps } =
    getOgabasseyImageFormatProps(input);
  const avifSource = disableAvifTier ? null : computedAvifSource;
  const [failedAvifSrcSet, setFailedAvifSrcSet] = useState<string | null>(null);
  const isAvifDisabled =
    avifSource !== null && failedAvifSrcSet === avifSource.srcSet;

  const handleError: ReactEventHandler<HTMLImageElement> = (event) => {
    const img = event.currentTarget;

    // Only the AVIF tier's own failure warrants disabling that tier.
    // Browsers without AVIF support skip the <source> and load the <img>
    // fallback directly, leaving the unused AVIF <source> in the DOM; a
    // fallback failure there (or after we've already disabled AVIF) must reach
    // the caller's onError instead of being swallowed. `currentSrc` names the
    // tier the browser actually selected, and AVIF candidate URLs are the only
    // ones carrying `format=avif`.
    if (avifSource && img.currentSrc.includes('format=avif')) {
      // Render without the failed React-owned <source>; the remaining <img>
      // fallback is already in the tree. Invoke the caller only if that
      // fallback subsequently fails as well.
      setFailedAvifSrcSet(avifSource.srcSet);
      return;
    }

    onError?.(event);
  };

  if (input.preload) {
    const avifHref = avifSource
      ? rewriteOgabasseyTransformUrlFormat(imgProps.src, 'avif')
      : null;
    if (avifSource && avifHref) {
      preload(avifHref, {
        as: 'image',
        fetchPriority: imgProps.fetchPriority,
        imageSizes: avifSource.sizes,
        imageSrcSet: avifSource.srcSet,
        type: 'image/avif',
      });
    } else {
      preload(imgProps.src, {
        as: 'image',
        fetchPriority: imgProps.fetchPriority,
        imageSizes: imgProps.sizes,
        imageSrcSet: imgProps.srcSet,
      });
    }
  }

  const img = (
    // biome-ignore lint/performance/noImgElement: intentional — per-format <picture> tiers require a raw <img>; props come from getImageProps so this stays next/image-equivalent.
    <img
      {...imgProps}
      alt={imgProps.alt}
      onError={handleError}
      onLoad={onLoad}
      ref={ref}
    />
  );

  if (!avifSource || isAvifDisabled) {
    return img;
  }

  return (
    <picture style={PICTURE_STYLE}>
      <source
        sizes={avifSource.sizes}
        srcSet={avifSource.srcSet}
        type="image/avif"
      />
      {img}
    </picture>
  );
}
