import { ArrowRightLeft, Heart, ShoppingCart, Star } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import type { Route } from 'next';
import type { Product } from '../types';
import {
  hasVisibleRating,
  ProductCardBadge,
  ProductCardImage,
  stripHtml,
} from './product-card-media';

export interface ProductCardListViewProps {
  contentVisibilityClasses: string;
  handleCartClick: (e: React.MouseEvent) => void;
  imagePriority?: boolean;
  isComparing: boolean;
  isLiked: boolean;
  linkAriaLabel: string;
  linkTitle: string;
  product: Product;
  productHref: Route;
  requiresSelection: boolean;
  showPlusOne: boolean;
  toggleCompare: (e: React.MouseEvent) => void;
  toggleLike: (e: React.MouseEvent) => void;
}

export const ProductCardListView: React.FC<ProductCardListViewProps> = ({
  contentVisibilityClasses,
  handleCartClick,
  imagePriority = false,
  isComparing,
  isLiked,
  linkAriaLabel,
  linkTitle,
  product,
  productHref,
  requiresSelection,
  showPlusOne,
  toggleCompare,
  toggleLike,
}) => (
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

    <div className="ogabassey-product-card-image-surface w-28 md:w-48 aspect-square bg-gray-50 rounded-xl shrink-0 flex items-center justify-center overflow-hidden z-10 pointer-events-none relative">
      <ProductCardImage
        product={product}
        sizes="(max-width: 768px) 112px, 192px"
        imagePriority={imagePriority}
        className="object-cover md:group-hover:scale-110 transition-transform duration-500"
      />
      <ProductCardBadge
        product={product}
        className="absolute top-2 left-2 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide z-10"
      />
    </div>

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
        {stripHtml(product.description || '').substring(0, 150) ||
          'No description available.'}
      </p>

      <div className="mt-auto flex items-center justify-between">
        <span className="text-primary font-bold text-xl">{product.price}</span>

        <div className="flex items-center gap-2 z-20 pointer-events-auto">
          <button
            type="button"
            onClick={toggleCompare}
            className={`p-2 rounded-lg transition-all duration-200 border ${
              isComparing
                ? 'bg-primary/10 border-primary/20 text-primary'
                : 'bg-white border-gray-200 text-gray-400 md:hover:border-primary/20 md:hover:text-primary'
            }`}
            aria-label={
              isComparing ? 'Remove from comparison' : 'Add to comparison'
            }
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
            <button
              type="button"
              onClick={handleCartClick}
              aria-label={`Add ${product.name} to cart`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 bg-gray-900 text-white md:hover:bg-primary relative overflow-visible"
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

    <button
      type="button"
      onClick={toggleLike}
      aria-label={isLiked ? 'Remove from wishlist' : 'Add to wishlist'}
      title={isLiked ? 'Remove from Wishlist' : 'Add to Wishlist'}
      className={`absolute top-4 right-4 z-20 p-2 rounded-full transition-all duration-200 pointer-events-auto active:scale-95 ${
        isLiked
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
