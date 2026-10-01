'use client';

import { ArrowRightLeft, Heart, ShoppingCart, Star } from 'lucide-react';
// Migrated from temp-source/components/ProductCard.tsx
import Link from 'next/link';
import React, { useState } from 'react';
import { getProductImageAlt, trimString } from '@baci/shared/lib';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import { asRoute } from '@/lib/routes';
import { getProductUrl } from '@/lib/product-url';
import { useV2Comparison } from '../providers/v2-comparison-context';
import { useV2Saved } from '../providers/v2-saved-context';
import { requiresOgabasseyProductSelection } from '../product-selection';
import type { Product } from '../types';

// Note: The getProductImage helper was removed because product data is now
// normalized upstream via normalizeProduct(), ensuring product.image is always set.

/**
 * Safely strips HTML tags from a string using iterative approach
 * to prevent bypass via nested tags like <<script>script>
 */
function stripHtml(html: string): string {
  if (!html) return '';
  let result = html;
  let prev = '';
  // Iterate until no more tags are found (handles nested/malformed tags)
  while (result !== prev) {
    prev = result;
    result = result.replace(/<[^>]*>/g, '');
  }
  return result;
}

// Mirrors ProductRatingRow's normalization: only real, finite, positive
// ratings earn a star row — never fabricated or degenerate values.
function hasVisibleRating(rating: number | undefined): rating is number {
  return (
    typeof rating === 'number' && Number.isFinite(rating) && rating > 0
  );
}

interface ProductCardProps {
  product: Product;
  onAddToCart: (e: React.MouseEvent, product: Product) => void;
  isAdded: boolean;
  viewMode?: 'grid' | 'list';
  /**
   * Overrides the card's built-in `content-visibility` reservation. The
   * category grid passes computed, responsive `contain-intrinsic-size`
   * reservations in FILTERED (unbounded, single-page) mode and an empty string
   * in PAGINATED (bounded, above-the-fold) mode so first-screen cards are never
   * deferred. Left undefined elsewhere, the card keeps its default reservation.
   */
  contentVisibilityClassName?: string;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onAddToCart,
  isAdded,
  viewMode = 'grid',
  contentVisibilityClassName,
}) => {
  // Preserve the pre-existing unconditional reservation for every other card
  // surface (home category grids, blog embeds, interactive grids). Only the
  // category page overrides it — with computed responsive values in filtered
  // mode, or an empty string to opt paginated above-the-fold cards out entirely.
  const contentVisibilityClasses =
    contentVisibilityClassName ??
    (viewMode === 'grid'
      ? 'content-auto [contain-intrinsic-size:auto_350px]'
      : 'content-auto [contain-intrinsic-size:auto_200px]');
  const { toggleSaved, isSaved } = useV2Saved();
  const { addToCompare, removeFromCompare, isInCompare } = useV2Comparison();
  const [showPlusOne, setShowPlusOne] = useState(false);
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath || '';

  const isLiked = isSaved(product.id);
  const isComparing = isInCompare(product.id);

  const toggleLike = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSaved(product);
  };

  const toggleCompare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isComparing) {
      removeFromCompare(product.id);
    } else {
      addToCompare(product);
    }
  };

  const handleCartClick = (e: React.MouseEvent) => {
    onAddToCart(e, product);

    // Trigger animation
    setShowPlusOne(true);
    setTimeout(() => setShowPlusOne(false), 1000); // Hide after animation
  };

  // Build semantic link attributes per Koray's methodology:
  // - Unique title/aria-label per product (no duplicate anchors)
  // - Links provide transactional frame signals ("Buy", "View")
  const linkTitle = `${product.name}${product.brand ? ` - ${product.brand}` : ''} ${product.condition || ''}`.trim();
  const linkAriaLabel = `Buy ${product.name} for ${product.price}`;

  // Ensure id is a string for getProductUrl (Product type allows number | string)
  const productForUrl = { ...product, id: String(product.id) };
  // Build full URL with basePath for proper routing on custom domains
  const productHref = asRoute(`${basePath}${getProductUrl(productForUrl)}`);
  const requiresSelection = requiresOgabasseyProductSelection(product);

  // Image optimization props for Next.js Image component
  // Using exact dimensions from design but allowing responsive sizing
  const imageSizes = viewMode === 'grid'
    ? '(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw'
    : '(max-width: 768px) 100px, 200px';
  const productImageUrl = trimString(product.image);
  const productImageSrc = productImageUrl || PLACEHOLDER_IMAGE;
  const productImageAlt = productImageUrl
    ? getProductImageAlt(product, {
        renderedImageUrl: productImageUrl,
      })
    : '';

  if (viewMode === 'grid') {
    return (
      <div
        className={`bg-white border border-gray-100 rounded-2xl p-3 md:p-4 shadow-sm md:hover:shadow-xl transition-[box-shadow,transform] duration-300 group flex flex-col h-full relative active:scale-[0.98] md:active:scale-100 touch-manipulation ${contentVisibilityClasses}`}
      >
        <Link
          href={productHref}
          title={linkTitle}
          aria-label={linkAriaLabel}
          className="absolute inset-0 z-0"
        >
          <span className="sr-only">
            {product.name} - {product.price}
          </span>
        </Link>

        {/* Badge: Platform or Condition - Positioned relative to card, not image */}
        {(product.variant_attributes?.Platform || product.condition) && (
          (() => {
            const platform = product.variant_attributes?.Platform;
            let badgeColor = 'bg-amber-500';
            // biome-ignore lint/suspicious/noExplicitAny: platform can be various types
            let badgeText = String(product.condition || '');

            if (platform) {
              badgeText = Array.isArray(platform) ? 'Multi-Platform' : String(platform);
              if (typeof badgeText === 'string') {
                const lower = badgeText.toLowerCase();
                if (lower.includes('playstation') || lower.includes('ps5') || lower.includes('ps4')) badgeColor = 'bg-blue-600';
                else if (lower.includes('xbox')) badgeColor = 'bg-green-600'; // Xbox Green
                else if (lower.includes('nintendo') || lower.includes('switch')) badgeColor = 'bg-red-600';
                else if (lower.includes('multi')) badgeColor = 'bg-purple-600';
              }
            } else if (product.condition === 'New') {
              badgeColor = 'bg-emerald-500';
            }

            // Shorten text for badges
            const display = badgeText === 'PlayStation 5' ? 'PS5' :
              badgeText === 'PlayStation 4' ? 'PS4' :
                badgeText === 'Nintendo Switch' ? 'Switch' :
                  badgeText;

            return (
              <div
                className={`absolute top-1.5 left-1.5 md:top-2 md:left-2 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shadow-md z-30 ${badgeColor}`}
              >
                {display}
              </div>
            );
          })()
        )}

        {/* Image Container */}
        <div className="ogabassey-product-card-image-surface relative aspect-square mb-3 md:mb-4 bg-gray-50 rounded-2xl flex items-center justify-center overflow-hidden z-10 pointer-events-none">
          {/* Using Next.js Image for LCP/FCP optimization */}
          {/* NOTE: explicit width/height required for remote images without fill, but here we want fill + object-cover */}
          {/* We use fill={true} with sizes prop for best performance */}
          {/* biome-ignore lint/a11y/useAltText: intentional img usage */}
          <CdnFormatImage
            src={productImageSrc}
            alt={productImageAlt}
            fill
            sizes={imageSizes}
            className="object-cover transition-transform duration-500 md:group-hover:scale-105"
          />

          {/* Action Buttons - Top Right */}
          <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 z-20 flex flex-col gap-1.5 md:gap-2">
            <button type="button"
              onClick={toggleLike}
              className={`h-7 w-7 md:h-8 md:w-8 flex items-center justify-center rounded-full shadow-sm border transition-all duration-200 pointer-events-auto active:scale-95 ${isLiked
                ? 'bg-white border-red-100 text-red-600'
                : 'bg-white/90 backdrop-blur-xs border-white/50 text-gray-500 md:hover:text-red-600 md:hover:bg-white'
                }`}
              aria-label={isLiked ? 'Remove from wishlist' : 'Add to wishlist'}
              title={isLiked ? 'Remove from Wishlist' : 'Add to Wishlist'}
            >
              <Heart
                size={14}
                fill={isLiked ? 'currentColor' : 'none'}
                strokeWidth={2}
                className="md:w-4 md:h-4"
              />
            </button>

            <button type="button"
              onClick={toggleCompare}
              className={`h-7 w-7 md:h-8 md:w-8 flex items-center justify-center rounded-full shadow-sm border transition-all duration-200 pointer-events-auto active:scale-95 ${isComparing
                ? 'bg-primary/10 border-primary/20 text-primary'
                : 'bg-white/90 backdrop-blur-xs border-white/50 text-gray-500 md:hover:text-primary md:hover:bg-white'
                }`}
              aria-label={isComparing ? 'Remove from comparison' : 'Add to comparison'}
              title={isComparing ? 'Remove from Compare' : 'Add to Compare'}
            >
              <ArrowRightLeft size={14} strokeWidth={2} className="md:w-4 md:h-4" />
            </button>
          </div>

          {/* Floating Cart Button - Inside Image Container for balance */}
          {requiresSelection ? (
            <Link
              href={productHref}
              prefetch={false}
              aria-label={`Choose options for ${product.name}`}
              className="absolute bottom-2 right-2 md:bottom-3 md:right-3 z-20 h-9 w-9 md:h-10 md:w-10 flex items-center justify-center rounded-full shadow-lg border border-gray-100 transition-all duration-300 pointer-events-auto active:scale-95 bg-white text-gray-900 md:hover:bg-primary md:hover:text-white md:hover:border-primary overflow-visible"
            >
              <ShoppingCart
                size={16}
                className="transition-transform md:w-[18px] md:h-[18px]"
                strokeWidth={2}
              />
            </Link>
          ) : (
            <button type="button"
              onClick={handleCartClick}
              aria-label={`Add ${product.name} to cart`}
              className={`absolute bottom-2 right-2 md:bottom-3 md:right-3 z-20 h-9 w-9 md:h-10 md:w-10 flex items-center justify-center rounded-full shadow-lg border border-gray-100 transition-all duration-300 pointer-events-auto active:scale-95 bg-white text-gray-900 md:hover:bg-primary md:hover:text-white md:hover:border-primary overflow-visible`}
            >
              <ShoppingCart
                size={16}
                className={`transition-transform md:w-[18px] md:h-[18px] ${showPlusOne ? 'scale-90' : ''}`}
                strokeWidth={2}
              />

              {/* +1 Animation */}
              {showPlusOne && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-primary font-bold text-sm animate-out fade-out slide-out-to-top-4 duration-1000 fill-mode-forwards z-30 pointer-events-none shadow-sm bg-white px-1.5 rounded-full border border-primary/20">
                  +1
                </span>
              )}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 pointer-events-none px-1 pt-1">

          {/* Ratings — only for products with real review data */}
          {hasVisibleRating(product.rating) && (
            <div className="flex items-center gap-1 mb-1.5">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={12}
                  className={`${i < Math.floor(product.rating ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
                />
              ))}
              <span className="text-[10px] text-gray-400 ml-1">
                ({product.rating})
              </span>
            </div>
          )}

          {/* Title - Red to match screenshot */}
          <h3 className="font-bold text-base text-gray-900 mb-1 leading-tight line-clamp-2 md:group-hover:text-primary transition-colors">
            {product.name}
          </h3>

          {/* Description - truncated */}
          <p className="text-gray-500 text-xs mb-3 line-clamp-2 leading-relaxed hidden md:block">
            {stripHtml(product.description || '').substring(0, 100) || 'No description available.'}
          </p>

          {/* Price */}
          <div className="mt-auto pt-2">
            <span className="text-primary font-extrabold text-lg tracking-tight">
              {product.price}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  return (
    <div
      className={`bg-white border border-gray-100 rounded-2xl p-4 shadow-sm md:hover:shadow-lg md:hover:border-red-100 transition-[box-shadow,border-color,transform] duration-300 group flex flex-row gap-4 md:gap-6 relative active:scale-[0.99] md:active:scale-100 touch-manipulation ${contentVisibilityClasses}`}
    >
      <Link
        href={productHref}
        title={linkTitle}
        aria-label={linkAriaLabel}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">
          {product.name} - {product.price}
        </span>
      </Link>

      {/* Image (Left Side) */}
      <div className="ogabassey-product-card-image-surface w-28 md:w-48 aspect-square bg-gray-50 rounded-xl shrink-0 flex items-center justify-center overflow-hidden z-10 pointer-events-none relative">
        <CdnFormatImage
          src={productImageSrc}
          alt={productImageAlt}
          fill
          sizes="(max-width: 768px) 112px, 192px"
          className="object-cover md:group-hover:scale-110 transition-transform duration-500"
        />
        {(product.variant_attributes?.Platform || product.condition) && (
          (() => {
            const platform = product.variant_attributes?.Platform;
            let badgeColor = 'bg-amber-500';
            // biome-ignore lint/suspicious/noExplicitAny: platform can be various types
            let badgeText = String(product.condition || '');

            if (platform) {
              badgeText = Array.isArray(platform) ? 'Multi-Platform' : String(platform);
              if (typeof badgeText === 'string') {
                const lower = badgeText.toLowerCase();
                if (lower.includes('playstation') || lower.includes('ps5') || lower.includes('ps4')) badgeColor = 'bg-blue-600';
                else if (lower.includes('xbox')) badgeColor = 'bg-green-600';
                else if (lower.includes('nintendo') || lower.includes('switch')) badgeColor = 'bg-red-600';
                else if (lower.includes('multi')) badgeColor = 'bg-purple-600';
              }
            } else if (product.condition === 'New') {
              badgeColor = 'bg-emerald-500';
            }

            const display = badgeText === 'PlayStation 5' ? 'PS5' :
              badgeText === 'PlayStation 4' ? 'PS4' :
                badgeText === 'Nintendo Switch' ? 'Switch' :
                  badgeText;

            return (
              <div
                className={`absolute top-2 left-2 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide z-10 ${badgeColor}`}
              >
                {display}
              </div>
            );
          })()
        )}
      </div>

      {/* Content (Right Side) */}
      <div className="flex flex-col flex-1 justify-center pointer-events-none pr-8">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg text-gray-900 md:group-hover:text-primary transition-colors line-clamp-1">
            {product.name}
          </h3>
          {hasVisibleRating(product.rating) && (
            <div
              className="hidden md:flex items-center gap-0.5"
              title={`${product.rating} out of 5 stars`}
            >
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={12}
                  className={`${i < Math.floor(product.rating ?? 0) ? 'fill-yellow-400 text-yellow-400' : 'fill-gray-100 text-gray-300'}`}
                />
              ))}
              <span className="text-xs text-gray-500 ml-1">
                ({product.rating})
              </span>
            </div>
          )}
        </div>

        <p className="text-gray-500 text-sm mb-3 line-clamp-3">
          {stripHtml(product.description || '').substring(0, 150) || 'No description available.'}
        </p>

        <div className="mt-auto flex items-center justify-between">
          <span className="text-primary font-bold text-xl">
            {product.price}
          </span>

          <div className="flex items-center gap-2 z-20 pointer-events-auto">
            {/* Compare Button (List View) */}
            <button type="button"
              onClick={toggleCompare}
              className={`p-2 rounded-lg transition-all duration-200 border ${isComparing
                ? 'bg-primary/10 border-primary/20 text-primary'
                : 'bg-white border-gray-200 text-gray-400 md:hover:border-primary/20 md:hover:text-primary'
                }`}
              aria-label={isComparing ? 'Remove from comparison' : 'Add to comparison'}
              title={isComparing ? 'Remove from Compare' : 'Add to Compare'}
            >
              <ArrowRightLeft size={18} strokeWidth={2} />
            </button>

            {requiresSelection ? (
              <Link
                href={productHref}
                prefetch={false}
                aria-label={`Choose options for ${product.name}`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 bg-gray-900 text-white md:hover:bg-primary relative overflow-visible"
              >
                View Options <ShoppingCart size={16} />
              </Link>
            ) : (
              <button type="button"
                onClick={handleCartClick}
                aria-label={`Add ${product.name} to cart`}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 bg-gray-900 text-white md:hover:bg-primary relative overflow-visible`}
              >
                {showPlusOne && (
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-primary font-bold text-lg animate-out fade-out slide-out-to-top-4 duration-1000 fill-mode-forwards z-30 pointer-events-none">
                    +1
                  </span>
                )}
                Add to Cart <ShoppingCart size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Wishlist Button - Absolute Top Right of Card in List View */}
      <button type="button"
        onClick={toggleLike}
        aria-label={isLiked ? 'Remove from wishlist' : 'Add to wishlist'}
        title={isLiked ? 'Remove from Wishlist' : 'Add to Wishlist'}
        className={`absolute top-4 right-4 z-20 p-2 rounded-full transition-all duration-200 pointer-events-auto active:scale-95 ${isLiked
          ? 'bg-primary/10 text-primary'
          : 'bg-white/80 backdrop-blur-xs text-gray-400 md:hover:bg-primary/10 md:hover:text-primary'
          }`}
      >
        <Heart
          size={18}
          fill={isLiked ? 'currentColor' : 'none'}
          strokeWidth={2}
        />
      </button>
    </div>
  );
};
