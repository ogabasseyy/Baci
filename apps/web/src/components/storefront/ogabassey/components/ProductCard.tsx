'use client';

import { ArrowRightLeft, Heart, ShoppingCart, Star } from 'lucide-react';
import Link from 'next/link';
import React, { useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { getProductUrl } from '@/lib/product-url';
import { asRoute } from '@/lib/routes';
import { requiresOgabasseyProductSelection } from '../product-selection';
import { useV2Comparison } from '../providers/v2-comparison-context';
import { useV2Saved } from '../providers/v2-saved-context';
import type { Product } from '../types';
import { ProductCardImage } from './product-card-image';
import { ProductCardListView } from './product-card-list-view';

interface ProductCardProps {
  product: Product;
  onAddToCart: (e: React.MouseEvent, product: Product) => void;
  isAdded: boolean;
  viewMode?: 'grid' | 'list';
  /** Overrides built-in `content-visibility` reservation (empty string disables deferral on first-screen paginated cards). */
  contentVisibilityClassName?: string;
  /** First-screen category candidates must not wait for lazy-load layout. */
  imagePriority?: boolean;
}

/** Strips HTML tags iteratively to prevent bypass via nested tags like `<<script>script>`. */
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

/** Only real, finite, positive ratings earn a star row. */
function hasVisibleRating(rating: number | undefined): rating is number {
  return typeof rating === 'number' && Number.isFinite(rating) && rating > 0;
}

const PLATFORM_LABELS: Record<string, string> = {
  'Nintendo Switch': 'Switch',
  'PlayStation 4': 'PS4',
  'PlayStation 5': 'PS5',
};

/** Resolves the platform or condition badge styling and display text for a product card. */
function resolveProductCardBadge(
  product: Product
): { colorClass: string; label: string } | null {
  const platform = product.variant_attributes?.Platform;
  if (!platform && !product.condition) return null;
  const badgeText = platform
    ? Array.isArray(platform)
      ? 'Multi-Platform'
      : String(platform)
    : String(product.condition || '');
  const lower = badgeText.toLowerCase();
  const colorClass = platform
    ? /playstation|ps5|ps4/.test(lower)
      ? 'bg-blue-600'
      : lower.includes('xbox')
        ? 'bg-green-600'
        : /nintendo|switch/.test(lower)
          ? 'bg-red-600'
          : lower.includes('multi')
            ? 'bg-purple-600'
            : 'bg-amber-500'
    : product.condition === 'New'
      ? 'bg-emerald-500'
      : 'bg-amber-500';
  return { colorClass, label: PLATFORM_LABELS[badgeText] ?? badgeText };
}

/** Renders the OgaBassey storefront product card in grid or list view. */
export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onAddToCart,
  viewMode = 'grid',
  contentVisibilityClassName,
  imagePriority = false,
}) => {
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
    setShowPlusOne(true);
    setTimeout(() => setShowPlusOne(false), 1000);
  };

  const linkTitle = `${product.name}${product.brand ? ` - ${product.brand}` : ''} ${product.condition || ''}`.trim();
  const linkAriaLabel = `Buy ${product.name} for ${product.price}`;
  const productForUrl = { ...product, id: String(product.id) };
  const productHref = asRoute(`${basePath}${getProductUrl(productForUrl)}`);
  const requiresSelection = requiresOgabasseyProductSelection(product);
  const badge = resolveProductCardBadge(product);
  const showRating = hasVisibleRating(product.rating);
  const plainDescription = stripHtml(product.description || '');

  if (viewMode !== 'grid') {
    return (
      <ProductCardListView
        badge={badge}
        contentVisibilityClasses={contentVisibilityClasses}
        descriptionPreview={
          plainDescription.substring(0, 150) || 'No description available.'
        }
        handleCartClick={handleCartClick}
        imagePriority={imagePriority}
        isComparing={isComparing}
        isLiked={isLiked}
        linkAriaLabel={linkAriaLabel}
        linkTitle={linkTitle}
        product={product}
        productHref={productHref}
        requiresSelection={requiresSelection}
        showPlusOne={showPlusOne}
        showRating={showRating}
        toggleCompare={toggleCompare}
        toggleLike={toggleLike}
      />
    );
  }

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

      {badge && (
        <div
          className={`absolute top-1.5 left-1.5 md:top-2 md:left-2 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shadow-md z-30 ${badge.colorClass}`}
        >
          {badge.label}
        </div>
      )}

      <div className="ogabassey-product-card-image-surface relative aspect-square mb-3 md:mb-4 bg-gray-50 rounded-2xl flex items-center justify-center overflow-hidden z-10 pointer-events-none">
        <ProductCardImage
          product={product}
          sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
          imagePriority={imagePriority}
          className="object-cover transition-transform duration-500 md:group-hover:scale-105"
        />

        <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 z-20 flex flex-col gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={toggleLike}
            className={`h-7 w-7 md:h-8 md:w-8 flex items-center justify-center rounded-full shadow-sm border transition-all duration-200 pointer-events-auto active:scale-95 ${
              isLiked
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

          <button
            type="button"
            onClick={toggleCompare}
            className={`h-7 w-7 md:h-8 md:w-8 flex items-center justify-center rounded-full shadow-sm border transition-all duration-200 pointer-events-auto active:scale-95 ${
              isComparing
                ? 'bg-primary/10 border-primary/20 text-primary'
                : 'bg-white/90 backdrop-blur-xs border-white/50 text-gray-500 md:hover:text-primary md:hover:bg-white'
            }`}
            aria-label={
              isComparing ? 'Remove from comparison' : 'Add to comparison'
            }
            title={isComparing ? 'Remove from Compare' : 'Add to Compare'}
          >
            <ArrowRightLeft
              size={14}
              strokeWidth={2}
              className="md:w-4 md:h-4"
            />
          </button>
        </div>

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
          <button
            type="button"
            onClick={handleCartClick}
            aria-label={`Add ${product.name} to cart`}
            className="absolute bottom-2 right-2 md:bottom-3 md:right-3 z-20 h-9 w-9 md:h-10 md:w-10 flex items-center justify-center rounded-full shadow-lg border border-gray-100 transition-all duration-300 pointer-events-auto active:scale-95 bg-white text-gray-900 md:hover:bg-primary md:hover:text-white md:hover:border-primary overflow-visible"
          >
            <ShoppingCart
              size={16}
              className={`transition-transform md:w-[18px] md:h-[18px] ${showPlusOne ? 'scale-90' : ''}`}
              strokeWidth={2}
            />
            {showPlusOne && (
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-primary font-bold text-sm animate-out fade-out slide-out-to-top-4 duration-1000 fill-mode-forwards z-30 pointer-events-none shadow-sm bg-white px-1.5 rounded-full border border-primary/20">
                +1
              </span>
            )}
          </button>
        )}
      </div>

      <div className="flex flex-col flex-1 pointer-events-none px-1 pt-1">
        {showRating && (
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

        <h3 className="font-bold text-base text-gray-900 mb-1 leading-tight line-clamp-2 md:group-hover:text-primary transition-colors">
          {product.name}
        </h3>

        <p className="text-gray-500 text-xs mb-3 line-clamp-2 leading-relaxed hidden md:block">
          {plainDescription.substring(0, 100) || 'No description available.'}
        </p>

        <div className="mt-auto pt-2">
          <span className="text-primary font-extrabold text-lg tracking-tight">
            {product.price}
          </span>
        </div>
      </div>
    </div>
  );
};
