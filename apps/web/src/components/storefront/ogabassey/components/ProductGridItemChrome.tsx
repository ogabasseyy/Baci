import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  ShoppingCart,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import type { Product } from '../types';
import { asRoute } from '@/lib/routes';
import { getProductUrl } from '@/lib/product-url';
import { requiresOgabasseyProductSelection } from '../product-selection';
import { ProductRatingRow } from './ProductRatingRow';

interface ProductGridImageChromeProps {
  activeColorIndex: number;
  basePath?: string;
  cartQuantity: number;
  iconSize: number;
  isAdded: boolean;
  isWishlisted: boolean;
  onAddToCart: (e: React.MouseEvent, product: Product) => void;
  onNextColor: (e: React.MouseEvent) => void;
  onPrevColor: (e: React.MouseEvent) => void;
  onSelectColor: (e: React.MouseEvent, index: number) => void;
  onToggleWishlist: (e: React.MouseEvent) => void;
  product: Product;
}

interface ProductGridContentChromeProps {
  basePath: string;
  cartQuantity: number;
  isAdded: boolean;
  product: Product;
  teaserDescription: string;
  viewMode: 'grid' | 'list';
}

function getHexColor(color: string | { name: string; value: string }) {
  if (typeof color === 'string') {
    return color.startsWith('#') ? color : '#cccccc';
  }

  return color.value;
}

export function ProductGridImageChrome({
  activeColorIndex,
  basePath = '',
  cartQuantity,
  iconSize,
  isAdded,
  isWishlisted,
  onAddToCart,
  onNextColor,
  onPrevColor,
  onSelectColor,
  onToggleWishlist,
  product,
}: ProductGridImageChromeProps) {
  const requiresSelection = requiresOgabasseyProductSelection(product);
  const productHref = asRoute(
    `${basePath}${getProductUrl({ ...product, id: String(product.id) })}`
  );
  const cartActionClass = `absolute bottom-3 right-3 z-20 h-10 w-10 flex items-center justify-center rounded-full shadow-md border-2 ring-2 ring-red-500/70 ring-offset-2 ring-offset-white transition-all duration-200 pointer-events-auto active:scale-90 ${
    isAdded
      ? 'bg-primary text-white md:hover:bg-primary/90'
      : 'bg-white text-gray-900 border-red-200 md:hover:text-primary md:hover:border-red-300'
  }`;

  return (
    <>
      {product.colors && product.colors.length > 1 && (
        <>
          <button type="button"
            onClick={onPrevColor}
            className="absolute -left-2 md:left-2 top-1/2 -translate-y-1/2 z-30 p-2 md:p-1.5 bg-transparent md:bg-white/40 md:backdrop-blur-md border-0 md:border md:border-white/50 rounded-full shadow-none md:shadow-sm text-gray-500 md:text-gray-700 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-200 md:hover:bg-white/60 hover:text-gray-900 pointer-events-auto active:scale-95 touch-manipulation"
            aria-label="Previous color"
          >
            <ChevronLeft size={24} className="md:w-[18px] md:h-[18px]" />
          </button>
          <button type="button"
            onClick={onNextColor}
            className="absolute -right-2 md:right-2 top-1/2 -translate-y-1/2 z-30 p-2 md:p-1.5 bg-transparent md:bg-white/40 md:backdrop-blur-md border-0 md:border md:border-white/50 rounded-full shadow-none md:shadow-sm text-gray-500 md:text-gray-700 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-200 md:hover:bg-white/60 hover:text-gray-900 pointer-events-auto active:scale-95 touch-manipulation"
            aria-label="Next color"
          >
            <ChevronRight size={24} className="md:w-[18px] md:h-[18px]" />
          </button>
        </>
      )}

      {product.variant_attributes?.Platform &&
        product.variant_attributes.Platform.length > 0 && (
          <div className="absolute bottom-2 left-3 flex gap-1 z-10 flex-wrap max-w-[70%]">
            {product.variant_attributes.Platform.slice(0, 3).map(
              (platform) => (
                <span
                  key={platform}
                  className="bg-white/90 backdrop-blur-xs text-gray-900 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm border border-gray-100 uppercase tracking-tighter"
                >
                  {platform
                    .replace('PlayStation ', 'PS')
                    .replace('Nintendo Switch', 'Switch')}
                </span>
              )
            )}
            {product.variant_attributes.Platform.length > 3 && (
              <span className="bg-white/90 backdrop-blur-xs text-gray-500 text-[9px] px-1 py-0.5 rounded">
                +
              </span>
            )}
          </div>
        )}

      {product.colors && product.colors.length > 0 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center -space-x-1.5 z-20 pointer-events-auto">
          {product.colors.slice(0, 4).map((color, index) => {
            const isSelected = index === activeColorIndex;
            const colorKey =
              typeof color === 'string' ? color : `${color.name}-${color.value}`;

            return (
              <button type="button"
                key={colorKey}
                onClick={(event) => onSelectColor(event, index)}
                className={`rounded-full border border-white shadow-sm transition-all duration-300 ease-out ${
                  isSelected
                    ? 'w-4 h-4 ring-2 ring-gray-300 ring-offset-1 z-30 scale-110'
                    : 'size-3.5 hover:scale-110 hover:z-20 opacity-90 hover:opacity-100'
                }`}
                style={{ backgroundColor: getHexColor(color) }}
                title={typeof color === 'string' ? color : color.name}
                aria-label={`Select color ${
                  typeof color === 'string' ? color : color.name
                }`}
              />
            );
          })}
          {product.colors.length > 4 && (
            <div className="size-3.5 rounded-full bg-gray-100 border border-white flex items-center justify-center text-[8px] font-bold text-gray-500 shadow-sm ml-0.5">
              +
            </div>
          )}
        </div>
      )}

      <button type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleWishlist(event);
        }}
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        className="absolute top-2 right-2 z-20 p-2 rounded-full bg-white/50 md:hover:bg-white active:bg-white backdrop-blur-xs shadow-sm transition-all duration-200 pointer-events-auto group/heart active:scale-90"
      >
        <Heart
          size={18}
          className={`transition-all duration-200 ${
            isWishlisted
              ? 'fill-primary text-primary scale-110'
              : 'text-gray-400 md:group-hover/heart:text-primary'
          }`}
        />
      </button>

      {requiresSelection ? (
        <Link
          href={productHref}
          prefetch={false}
          aria-label={`Choose options for ${product.name}`}
          className={cartActionClass}
        >
          <ShoppingCart size={iconSize} />
          {cartQuantity > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 flex items-center justify-center bg-primary text-white text-[10px] font-bold rounded-full border-2 border-white shadow-sm">
              {cartQuantity > 99 ? '99+' : cartQuantity}
            </span>
          )}
        </Link>
      ) : (
        <button type="button"
          onClick={(event) => onAddToCart(event, product)}
          aria-label={
            isAdded
              ? `${product.name} added to cart`
              : `Add ${product.name} to cart`
          }
          className={cartActionClass}
        >
          {isAdded ? <Check size={iconSize} /> : <ShoppingCart size={iconSize} />}
          {cartQuantity > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 flex items-center justify-center bg-primary text-white text-[10px] font-bold rounded-full border-2 border-white shadow-sm">
              {cartQuantity > 99 ? '99+' : cartQuantity}
            </span>
          )}
        </button>
      )}
    </>
  );
}

export function ProductGridContentChrome({
  basePath,
  cartQuantity,
  isAdded,
  product,
  teaserDescription,
  viewMode,
}: ProductGridContentChromeProps) {
  return (
    <>
      <ProductRatingRow rating={product.rating} />

      <p
        className={`text-gray-400 text-[11px] mb-2 line-clamp-1 ${
          viewMode === 'list' ? 'block' : 'hidden md:block'
        }`}
      >
        {teaserDescription.slice(0, 60)}
        {teaserDescription.length > 60 ? '...' : ''}
        <span className="text-primary font-medium ml-1">View specs →</span>
      </p>

      {(cartQuantity > 0 || isAdded) && (
        <Link
          href={asRoute(`${basePath}/cart`)}
          className="hidden md:flex items-center justify-center gap-2 mt-3 py-2.5 px-4 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-xl transition-all duration-200 pointer-events-auto relative z-20"
          onClick={(event) => event.stopPropagation()}
        >
          <ShoppingCart size={16} />
          View Cart{cartQuantity > 0 ? ` (${cartQuantity})` : ''}
        </Link>
      )}
    </>
  );
}
