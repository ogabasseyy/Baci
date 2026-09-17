'use client';
// Template preview

import dynamic from 'next/dynamic';
import Link from 'next/link';
import type React from 'react';
import { useState } from 'react';
import { getProductImageAlt } from '@baci/shared/lib';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { Product } from '../types';
import { useViewportActivation } from '@/components/storefront/use-viewport-activation';
import { getProductUrl } from '@/lib/product-url';
import { asRoute } from '@/lib/routes';
import { useDeferredActivation } from './deferred-shell-feature';
import { resolveProductImageSource } from './product-image-source';

const DeferredProductGridImageChrome = dynamic(
  () =>
    import('./ProductGridItemChrome').then(
      (mod) => mod.ProductGridImageChrome
    ),
  { loading: () => null }
);

const DeferredProductGridContentChrome = dynamic(
  () =>
    import('./ProductGridItemChrome').then(
      (mod) => mod.ProductGridContentChrome
    ),
  { loading: () => null }
);

/**
 * Safely strips HTML tags from a string using iterative approach
 * to prevent bypass via nested tags like <<script>script>
 */
function stripHtml(html: string): string {
  if (!html) return '';
  let result = html;
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(/<[^>]*>/g, '');
  }
  return result;
}

export interface ProductGridItemProps {
  product: Product;
  onAddToCart: (e: React.MouseEvent, product: Product) => void;
  isAdded: boolean;
  cartQuantity?: number;
  viewMode?: 'grid' | 'list';
  isWishlisted: boolean;
  onToggleWishlist: (e: React.MouseEvent) => void;
  basePath?: string;
  deferInteractiveChrome?: boolean;
  interactiveChromeTimeoutMs?: number;
  interactiveChromeActivateOnIdle?: boolean;
  deferImageLoading?: boolean;
}

export const ProductGridItem: React.FC<ProductGridItemProps> = ({
  product,
  onAddToCart,
  isAdded,
  cartQuantity = 0,
  viewMode = 'grid',
  isWishlisted,
  onToggleWishlist,
  basePath = '',
  deferInteractiveChrome = false,
  interactiveChromeTimeoutMs = 1400,
  interactiveChromeActivateOnIdle = true,
  deferImageLoading = false,
}) => {
  const iconSize = viewMode === 'list' ? 22 : 18;

  // State to track selected color
  const [activeColorIndex, setActiveColorIndex] = useState(0);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const interactiveChromeActivated = useDeferredActivation({
    enabled: deferInteractiveChrome,
    timeoutMs: interactiveChromeTimeoutMs,
    activateOnIdle: interactiveChromeActivateOnIdle,
  });
  const { ref: imageViewportRef, isActive: isImageViewportActive } =
    useViewportActivation<HTMLDivElement>({
      enabled: deferImageLoading,
      rootMargin: '150px 0px',
      timeoutMs: 6000,
    });
  const showInteractiveChrome =
    !deferInteractiveChrome || interactiveChromeActivated;
  const shouldRenderImage = !deferImageLoading || isImageViewportActive;

  // Fallback placeholder for products without images
  const PLACEHOLDER_IMAGE =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"%3E%3Crect fill="%23f3f4f6" width="400" height="400"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="48" fill="%239ca3af"%3ENo Image%3C/text%3E%3C/svg%3E';

  // Determine current image: use the specific color image if available, otherwise fallback to main image or placeholder
  const currentImage = resolveProductImageSource(
    [product.images?.[activeColorIndex], product.image],
    PLACEHOLDER_IMAGE
  );
  const currentImageAlt = currentImage.isPlaceholder
    ? ''
    : getProductImageAlt(product, {
        renderedImageUrl: currentImage.src,
      });
  const teaserDescription = stripHtml(product.description || '')
    .replace(/What is the .*? Price in Nigeria\??/i, '')
    .trim();

  // Reset loading state when image source changes — adjusted inline during
  // render with a prev-compare so the skeleton shows on the very next commit.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevImageSrc, setPrevImageSrc] = useState(currentImage.src);
  if (currentImage.src !== prevImageSrc) {
    setPrevImageSrc(currentImage.src);
    setIsImageLoaded(false);
  }

  const handlePrevColor = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product.colors || product.colors.length === 0) return;
    const colorsLength = product.colors.length;
    setActiveColorIndex((prev) => (prev === 0 ? colorsLength - 1 : prev - 1));
  };

  const handleNextColor = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product.colors || product.colors.length === 0) return;
    const colorsLength = product.colors.length;
    setActiveColorIndex((prev) => (prev === colorsLength - 1 ? 0 : prev + 1));
  };

  const handleColorSelect = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveColorIndex(index);
  };

  return (
    <div
      className={`bg-white border border-gray-100 rounded-2xl p-3 md:p-4 shadow-sm md:hover:shadow-xl active:shadow-md active:scale-[0.99] transition-all duration-300 group flex flex-col h-full relative content-auto ${viewMode === 'list'
        ? '[contain-intrinsic-size:auto_220px]'
        : '[contain-intrinsic-size:auto_360px]'
        }`}
    >
      <Link
        href={asRoute(`${basePath}${getProductUrl({ ...product, id: String(product.id) })}`)}
        prefetch={false}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">
          {product.name} - {product.price}
        </span>
      </Link>

      {/* Image Container - Gray Box with Overlapping Button */}
      {/* overflow-visible needed for the button to hang off the edge */}
      <div
        ref={imageViewportRef}
        className="ogabassey-product-card-image-surface relative aspect-square mb-3 md:mb-4 bg-gray-50 rounded-2xl flex items-center justify-center overflow-visible z-10 pointer-events-none"
      >
        {/* Skeleton Loader */}
        {!isImageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <div className="w-2/3 h-2/3 bg-gray-200 rounded-lg animate-pulse" />
          </div>
        )}

        {shouldRenderImage && (
          <CdnFormatImage
            src={currentImage.src}
            alt={currentImageAlt}
            fill
            sizes="(max-width: 480px) 40vw, (max-width: 768px) 33vw, (max-width: 1200px) 25vw, 20vw"
            loading="lazy"
            fetchPriority="low"
            // A cached image on an SSR'd native <img> can be `complete` before
            // hydration attaches onLoad — without this mount-time check the
            // card would keep its skeleton and hold the image at opacity-0.
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0) {
                setIsImageLoaded(true);
              }
            }}
            onLoad={() => setIsImageLoaded(true)}
            onError={() => {
              // Note: `next/image` handles fallbacks differently, usually via `blurDataURL` or state.
              // For now, simpler error handling or ensuring data is good is preferred.
              // If strictly needed, we'd switch src state. However, next/image validates src.
              setIsImageLoaded(true);
            }}
            className={`object-contain p-4 transition-all duration-500 z-10 ${isImageLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
          />
        )}

        {/* Condition Badge - Top Left */}
        {product.condition && (
          <div
            className={`absolute top-3 left-3 text-white text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide shadow-sm z-10 whitespace-nowrap ${product.condition === 'New'
              ? 'bg-gray-900'
              : product.condition === 'Open Box'
                ? 'bg-indigo-600'
                : product.condition === 'New & Used'
                  ? 'bg-purple-600'
                  : product.condition === 'Multiple Conditions'
                    ? 'bg-store-primary'
                  : 'bg-stone-500'
              }`}
          >
            {product.condition}
          </div>
        )}

        {showInteractiveChrome && (
          <DeferredProductGridImageChrome
            activeColorIndex={activeColorIndex}
            basePath={basePath}
            cartQuantity={cartQuantity}
            iconSize={iconSize}
            isAdded={isAdded}
            isWishlisted={isWishlisted}
            onAddToCart={onAddToCart}
            onNextColor={handleNextColor}
            onPrevColor={handlePrevColor}
            onSelectColor={handleColorSelect}
            onToggleWishlist={onToggleWishlist}
            product={product}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 pointer-events-none px-1 pt-1">
        {/* Title - Dark Gray (Standard) with Red Hover */}
        <h3 className="font-bold text-base text-gray-900 mb-1 leading-tight line-clamp-2 md:group-hover:text-primary transition-colors">
          {product.name}
          {product.spec && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-200 align-middle leading-none tracking-normal">
              {product.spec}
            </span>
          )}
        </h3>

        {showInteractiveChrome && (
          <DeferredProductGridContentChrome
            basePath={basePath}
            cartQuantity={cartQuantity}
            isAdded={isAdded}
            product={product}
            teaserDescription={teaserDescription}
            viewMode={viewMode}
          />
        )}

        {/* Price & Details */}
        <div className="mt-auto flex items-end justify-between border-t border-dashed border-gray-100 pt-3">
          <span className="text-primary font-extrabold text-lg tracking-tight">
            {product.price}
          </span>
          <span className="text-xs font-semibold text-gray-900 mb-0.5 md:hover:text-primary pointer-events-auto cursor-pointer active:text-primary">
            Details
          </span>
        </div>
      </div>
    </div>
  );
};
