'use client';

import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { isExternalPlaceholderImageUrl } from '@/lib/image-utils';
import { getProductUrl } from '@/lib/seo-utils';
import {
  AD_CONFIG,
  CATEGORY_CAROUSEL_AD_BOOT_DELAY_MS,
} from '../config/ads';
import type { Product } from '../types';
import { AdUnit } from './AdUnit';
import {
  LaunchCarousel,
  type LaunchProductSlide,
  type LaunchSlide,
} from './LaunchCarousel';

const RECENT_SLIDE_LIMIT = 6;

// Normalized products carry `/placeholder.svg` (or `.png`) when no image was
// uploaded; imported ones may carry external placeholder-service URLs (which the
// image loader rewrites to the local placeholder). Treat both as missing so they
// don't fill prominent slots ahead of real product photos.
const PLACEHOLDER_IMAGE_PATTERN = /\/placeholder\.(svg|png)$/i;

// The configured in-feed banner placement for the carousel ad slide.
const AD_PLACEMENT = 'CATEGORY_CAROUSEL_BANNER' as const;

/** Returns a trimmed, real image URL, or undefined for blank/placeholder ones. */
function cleanUsableImage(src: string | null | undefined): string | undefined {
  const trimmed = src?.trim();
  if (!trimmed) {
    return undefined;
  }
  // Drop any query/hash so a cache-busted placeholder (…/placeholder.svg?v=1)
  // still matches the end-anchored pattern.
  const pathOnly = trimmed.replace(/[?#].*$/, '');
  if (
    PLACEHOLDER_IMAGE_PATTERN.test(pathOnly) ||
    isExternalPlaceholderImageUrl(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

function usableImageUrl(product: Product): string | undefined {
  // Scan the primary image and the full gallery for the first real upload — a
  // blank/placeholder primary must not hide a usable later entry.
  for (const candidate of [product.image, ...(product.images ?? [])]) {
    const clean = cleanUsableImage(candidate);
    if (clean) {
      return clean;
    }
  }
  return undefined;
}

interface CategoryRecentCarouselProps {
  /** Category products, newest-first (the category query orders by created_at
   *  descending), so the first slides are the most recently added. */
  products: Product[];
  categoryName: string;
  /** Category artwork, used as a banner fallback when no products have images. */
  categoryImage?: string | null;
}

/**
 * Category banner carousel — the product-driven replacement for the static promo
 * banner. It surfaces the most recently-added products in the category as an
 * auto-scrolling carousel by reusing the home `LaunchCarousel` (single slide per
 * view, swipe, autoplay with pause/reduced-motion, lazy images, progress bars).
 * Each slide deep-links to its PDP, so the markup stays crawlable. When no
 * product has a usable image it falls back to the category artwork (preserving
 * the legacy banner behaviour) and otherwise renders nothing.
 */
export function CategoryRecentCarousel({
  categoryName,
  categoryImage,
  products,
}: CategoryRecentCarouselProps) {
  const merchant = useMerchantSafe();
  const basePath = merchant?.basePath || '';

  const productSlides: LaunchProductSlide[] = products
    .map((product) => ({ product, imageUrl: usableImageUrl(product) }))
    .filter(
      (entry): entry is { product: Product; imageUrl: string } =>
        entry.imageUrl !== undefined
    )
    .slice(0, RECENT_SLIDE_LIMIT)
    .map(({ product, imageUrl }) => ({
      kind: 'product',
      id: String(product.id),
      name: product.name,
      priceLabel: product.price,
      // Raw path; LaunchCarousel applies asRoute() at the link.
      href: `${basePath}${getProductUrl({ ...product, id: String(product.id) })}`,
      imageUrl,
      imageAlt: product.name,
      ctaLabel: 'Shop now',
    }));

  if (productSlides.length === 0) {
    // Fall back to the category artwork banner (legacy behaviour) if present.
    const fallbackImage = cleanUsableImage(categoryImage);
    if (!fallbackImage) {
      return null;
    }
    return (
      <section className="mx-auto mb-4 max-w-[1400px] px-4 md:px-6">
        <div className="relative h-52 w-full overflow-hidden rounded-xl border border-store-border bg-store-background shadow-sm md:h-60 lg:h-64">
          <CdnFormatImage
            src={fallbackImage}
            alt={categoryName}
            fill
            sizes="(max-width: 768px) 100vw, 1400px"
            className="object-cover"
            loading="eager"
            fetchPriority="high"
          />
        </div>
      </section>
    );
  }

  // Surface the in-feed banner ad as the second slide (right after the lead
  // product), but only when the placement is configured so it can render. It
  // loads immediately (with a short delay) because the carousel rotates it into
  // view at ~6s — a viewport/long-delay load would still be a placeholder then.
  const adSlide: LaunchSlide | null = AD_CONFIG[AD_PLACEMENT]
    ? {
        kind: 'ad',
        id: 'category-recent-ad',
        content: (
          <AdUnit
            bootDelayMs={CATEGORY_CAROUSEL_AD_BOOT_DELAY_MS}
            loadStrategy="immediate"
            placementKey={AD_PLACEMENT}
          />
        ),
      }
    : null;

  const slides: LaunchSlide[] = adSlide
    ? productSlides.flatMap((slide, index) =>
        index === 0 ? [slide, adSlide] : [slide]
      )
    : productSlides;

  return (
    // Layout wrapper only (no aria-label, so it isn't a second landmark); the
    // LaunchCarousel region below carries the accessible name.
    <section className="mx-auto mb-4 max-w-[1400px] px-4 md:px-6">
      <LaunchCarousel
        prioritizeFirstSlide
        regionLabel={`Just in: ${categoryName}`}
        slides={slides}
      />
    </section>
  );
}
