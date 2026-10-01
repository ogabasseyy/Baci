'use client';
// Template preview

import { getProductImageAlt } from '@baci/shared/lib';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  ShoppingCart,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import { asRoute } from '@/lib/routes';
import { getProductUrl } from '@/lib/product-url';
import { requiresOgabasseyProductSelection } from '../product-selection';
import type { Product } from '../types';
import { resolveProductImageSource } from './product-image-source';

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

interface ProductListItemProps {
  product: Product;
  onAddToCart: (e: React.MouseEvent, product: Product) => void;
  isAdded: boolean;
  isWishlisted: boolean;
  onToggleWishlist: (e: React.MouseEvent) => void;
  basePath?: string;
}

export const ProductListItem: React.FC<ProductListItemProps> = ({
  product,
  onAddToCart,
  isAdded,
  isWishlisted,
  onToggleWishlist,
  basePath = '',
}) => {
  const [activeColorIndex, setActiveColorIndex] = useState(0);
  // Remember which src finished loading; the visible loading flag derives
  // from it during render, so swapping the active image resets the skeleton
  // without adjusting state from an effect.
  const [loadedImageSrc, setLoadedImageSrc] = useState<string | null>(null);

  // Determine current image with fallback
  const currentImage = resolveProductImageSource(
    [product.images?.[activeColorIndex], product.image],
    PLACEHOLDER_IMAGE
  );
  const currentImageAlt = currentImage.isPlaceholder
    ? ''
    : getProductImageAlt(product, {
        renderedImageUrl: currentImage.src,
      });
  const productHref = asRoute(
    `${basePath}${getProductUrl({ ...product, id: String(product.id) })}`
  );
  const linkTitle =
    `${product.name}${product.brand ? ` - ${product.brand}` : ''}`.trim();
  const requiresSelection = requiresOgabasseyProductSelection(product);
  const isImageLoaded = loadedImageSrc === currentImage.src;

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
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm md:hover:shadow-lg md:hover:border-red-100 active:scale-[0.99] transition-all duration-300 group flex flex-row gap-4 md:gap-6 relative content-auto [contain-intrinsic-size:auto_220px]">
      <Link
        href={productHref}
        prefetch={false}
        title={linkTitle}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">
          View {product.name} for {product.price}
        </span>
      </Link>


      {/* Image (Left Side) */}
      <div className="ogabassey-product-card-image-surface w-28 md:w-48 aspect-square bg-gray-50 rounded-xl shrink-0 flex items-center justify-center overflow-hidden z-10 pointer-events-none relative">
        {/* Navigation Arrows (Desktop Hover Only) */}
        {product.colors && product.colors.length > 1 && (
          <>
            <button type="button"
              onClick={handlePrevColor}
              aria-label="Previous color"
              className="absolute left-1 top-1/2 -translate-y-1/2 z-30 p-1 bg-white/40 backdrop-blur-md border border-white/50 rounded-full shadow-sm text-gray-700 opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 hover:bg-white/60 hover:text-gray-900 pointer-events-auto"
            >
              <ChevronLeft size={14} />
            </button>
            <button type="button"
              onClick={handleNextColor}
              aria-label="Next color"
              className="absolute right-1 top-1/2 -translate-y-1/2 z-30 p-1 bg-white/40 backdrop-blur-md border border-white/50 rounded-full shadow-sm text-gray-700 opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 hover:bg-white/60 hover:text-gray-900 pointer-events-auto"
            >
              <ChevronRight size={14} />
            </button>
          </>
        )}

        {/* Skeleton Loader */}
        {!isImageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <div className="w-3/4 h-3/4 bg-gray-200 rounded-lg animate-pulse" />
          </div>
        )}

        <div className="relative w-3/4 h-3/4 z-10 transition-all duration-500 md:group-hover:scale-110">
          <CdnFormatImage
            src={currentImage.src}
            alt={currentImageAlt}
            fill
            sizes="(max-width: 768px) 100px, 200px"
            // A cached image on the SSR'd native <img> can be `complete` before
            // hydration attaches onLoad — without this mount-time check the card
            // would keep its skeleton and hold the image at opacity-0.
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0) {
                setLoadedImageSrc(currentImage.src);
              }
            }}
            onLoad={() => setLoadedImageSrc(currentImage.src)}
            className={`object-contain mix-blend-multiply ${isImageLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>

        {/* Condition Badge - Top Left */}
        {product.condition && (
          <div
            className={`absolute top-2 left-2 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shadow-sm whitespace-nowrap z-20 ${product.condition === 'New'
              ? 'bg-gray-900'
              : product.condition === 'Open Box'
                ? 'bg-indigo-600'
                : product.condition === 'New & Used'
                  ? 'bg-purple-600'
                  : 'bg-stone-500'
              }`}
          >
            {product.condition}
          </div>
        )}

        {/* Colors Swatches - Bottom Middle - Interactive */}
        {product.colors && product.colors.length > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center -space-x-1.5 z-20 pointer-events-auto">
            {product.colors.slice(0, 4).map((color, idx) => {
              const hexColor = typeof color === 'string'
                ? (color.startsWith('#') ? color : '#cccccc')
                : color.value;
              const isSelected = idx === activeColorIndex;
              const colorName = typeof color === 'string' ? color : color.name;
              return (
                <button type="button"
                  key={idx}
                  onClick={(e) => handleColorSelect(e, idx)}
                  aria-label={`Select ${colorName} color`}
                  className={`rounded-full border border-white shadow-sm transition-all duration-300 ease-out ${isSelected
                    ? 'w-3.5 h-3.5 ring-2 ring-gray-300 ring-offset-1 z-30 scale-110'
                    : 'w-3 h-3 hover:scale-110 hover:z-20 opacity-90 hover:opacity-100'
                    }`}
                  style={{ backgroundColor: hexColor }}
                  title={colorName}
                />
              );
            })}
          </div>
        )}

        {/* Wishlist Button - Top Right of Image */}
        <button type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleWishlist(e);
          }}
          aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          title={isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          className="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-white/60 md:hover:bg-white active:bg-white backdrop-blur-xs shadow-sm transition-all duration-200 pointer-events-auto group/heart active:scale-90"
        >
          <Heart
            size={16}
            className={`transition-all duration-200 ${isWishlisted
              ? 'fill-red-500 text-red-500 scale-110'
              : 'text-gray-400 md:group-hover/heart:text-red-500'
              }`}
          />
        </button>
      </div>

      {/* Content (Right Side) */}
      <div className="flex flex-col flex-1 justify-center pointer-events-none">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-gray-900 md:group-hover:text-red-600 transition-colors line-clamp-1">
            {product.name}
            {product.spec && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-500 border border-gray-200 align-middle leading-none tracking-normal">
                {product.spec}
              </span>
            )}
          </h3>
          <div className="hidden md:flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={12}
                  className={`${i < Math.floor(product.rating ?? 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                />
              ))}
            </div>
          </div>
        </div>

        <p className="text-gray-500 text-sm mb-3 line-clamp-2 md:line-clamp-none">
          {stripHtml(product.description || '').replace(/What is the .*? Price in Nigeria\??/i, '').trim()}
        </p>

        <div className="mt-auto flex items-center justify-between">
          <span className="text-red-600 font-bold text-xl">
            {product.price}
          </span>

          {requiresSelection ? (
            <Link
              href={productHref}
              prefetch={false}
              aria-label={`Choose options for ${product.name}`}
              className="z-20 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 bg-gray-900 text-white md:hover:bg-red-600 active:bg-red-700 pointer-events-auto"
            >
              View Options <ShoppingCart size={20} />
            </Link>
          ) : (
            <button type="button"
              onClick={(e) => onAddToCart(e, product)}
              className={`z-20 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 ${isAdded
                ? 'bg-red-600 text-white pointer-events-none'
                : 'bg-gray-900 text-white md:hover:bg-red-600 active:bg-red-700 pointer-events-auto'
                }`}
            >
              {isAdded ? (
                <>
                  Added <Check size={20} />
                </>
              ) : (
                <>
                  Add to Cart <ShoppingCart size={20} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div >
  );
};
