'use client';

// Client component: tracks broken-image state (useState) so the gallery can
// fall back to a working image when a CDN photo 404s. (ADR-003)

import { useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { DeferredShellFeature } from '@/components/storefront/ogabassey/components/deferred-shell-feature';
import {
  OGABASSEY_PDP_PRIMARY_IMAGE_QUALITY,
  OGABASSEY_PDP_FULL_FRAME_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/product-media';
import type {
  ConditionType,
  NormalizedProductDetails,
} from './product-details-helpers';
import { formatConditionLabel } from './product-condition';

interface ProductMediaGalleryProps {
  onSelectImage: (index: number) => void;
  productData: NormalizedProductDetails;
  selectedCondition: ConditionType;
  selectedImage: number;
}

export function ProductMediaGallery({
  onSelectImage,
  productData,
  selectedCondition,
  selectedImage,
}: ProductMediaGalleryProps) {
  // Track images that fail to load (e.g. a variant photo that 404s on the CDN)
  // so the main view never shows a broken image — it falls back to the first
  // image that still loads, and broken thumbnails render a neutral placeholder.
  const [brokenImages, setBrokenImages] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const markImageBroken = (src: string) => {
    setBrokenImages((previous) => {
      if (!src || previous.has(src)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(src);
      return next;
    });
  };
  const handleMainImageError = (src: string) => {
    const nextBrokenImages = new Set(brokenImages);
    nextBrokenImages.add(src);
    const fallbackIndex = productData.images.findIndex(
      (image) => image && !nextBrokenImages.has(image)
    );

    markImageBroken(src);

    if (fallbackIndex >= 0 && fallbackIndex !== selectedImage) {
      onSelectImage(fallbackIndex);
    }
  };

  const badgeCondition = (
    selectedCondition ||
    productData.condition ||
    'new'
  ).toLowerCase();
  const badgeClass =
    badgeCondition === 'new'
      ? 'bg-store-primary text-store-primary-text'
      : 'bg-[color-mix(in_srgb,var(--store-primary)_65%,var(--store-background-text,#111827))] text-store-primary-text';
  const thumbnailFallback = (
    <div
      aria-hidden="true"
      className="hide-scrollbar flex gap-4 overflow-x-auto pb-2"
    >
      {productData.images.slice(0, 4).map((image, index) => (
        <div
          key={`${image}-${index}`}
          className="size-24 shrink-0 rounded-xl bg-gray-100"
        />
      ))}
    </div>
  );
  const hasMultipleImages = productData.images.length > 1;

  const selectedSrc = productData.images[selectedImage];
  const fallbackMainImageSrc = productData.images.find(
    (image) => image && !brokenImages.has(image)
  );
  const mainImageSrc =
    selectedSrc && !brokenImages.has(selectedSrc)
      ? selectedSrc
      : (fallbackMainImageSrc ?? null);

  return (
    <div className="space-y-6 lg:col-span-5">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
        {mainImageSrc ? (
          // Explicit per-format `<picture>` (AVIF `<source>` + jpeg/png `<img>`
          // fallback) matching the PDP hero preload — `preload` fires the AVIF
          // hint that dedupes against the rendered `<source>`. Cloudflare Free
          // ignores `Vary: Accept`, so a single `format=auto` URL could hand
          // non-AVIF browsers undecodable bytes.
          <CdnFormatImage
            key={mainImageSrc}
            src={mainImageSrc}
            alt={productData.name}
            fill
            className="object-cover"
            sizes={OGABASSEY_PDP_FULL_FRAME_IMAGE_SIZES}
            preload
            decoding="sync"
            quality={OGABASSEY_PDP_PRIMARY_IMAGE_QUALITY}
            onError={() => handleMainImageError(mainImageSrc)}
          />
        ) : null}
        <div
          className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${badgeClass}`}
        >
          {formatConditionLabel(badgeCondition)}
        </div>
      </div>

      {hasMultipleImages ? (
        <DeferredShellFeature fallback={thumbnailFallback} timeoutMs={1200}>
          <div
            className="hide-scrollbar flex gap-4 overflow-x-auto pb-2"
            aria-label="Product media thumbnails"
          >
            {productData.images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => onSelectImage(index)}
                aria-label={`View image ${index + 1}`}
                className={`relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50 p-0 transition-all active:scale-95 ${
                  selectedImage === index
                    ? 'border-2 border-store-primary ring-2 ring-store-primary/20'
                    : 'border-2 border-transparent md:hover:border-gray-200'
                }`}
              >
                {brokenImages.has(image) ? (
                  <div aria-hidden="true" className="size-full bg-gray-100" />
                ) : (
                  // Explicit per-format `<picture>` (AVIF `<source>` + jpeg/png
                  // `<img>` fallback) so Cloudflare Free never hands non-AVIF
                  // browsers undecodable bytes off a shared `format=auto` cache
                  // key. Thumbnails stay lazy/off-critical-path, so their q50
                  // width tier is deliberately NOT prewarmed (see
                  // ogabassey-image-prewarm-pairs.ts).
                  <CdnFormatImage
                    src={image}
                    alt={`View ${index + 1}`}
                    fill
                    className="object-cover"
                    sizes="96px"
                    loading="lazy"
                    quality={50}
                    onError={() => markImageBroken(image)}
                  />
                )}
              </button>
            ))}
          </div>
        </DeferredShellFeature>
      ) : null}
    </div>
  );
}
