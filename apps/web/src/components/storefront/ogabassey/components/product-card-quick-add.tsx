import { Check, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

interface ProductCardQuickAddProps {
  handleCartClick: (event: React.MouseEvent) => void;
  isAdded: boolean;
  productHref: React.ComponentProps<typeof Link>['href'];
  productName: string;
  requiresSelection: boolean;
  showPlusOne: boolean;
}

/**
 * The grid card's cart control: a link to the product page when a
 * choice is needed, otherwise a quick-add button with a visible and
 * announced "Added to cart" confirmation.
 */
export function ProductCardQuickAdd({
  handleCartClick,
  isAdded,
  productHref,
  productName,
  requiresSelection,
  showPlusOne,
}: ProductCardQuickAddProps) {
  return (
    <>
      {/* A thumb covers the small cart button on a phone, so the
          confirmation also shows beside it. */}
      <span role="status" className="sr-only">
        {isAdded && !requiresSelection
          ? `${productName} added to cart`
          : ''}
      </span>
      {isAdded && !requiresSelection && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-2 md:bottom-3 md:left-3 z-20 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-white shadow-lg"
        >
          Added to cart
        </span>
      )}

      {requiresSelection ? (
        <Link
          href={productHref}
          prefetch={false}
          aria-label={`Choose options for ${productName}`}
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
          aria-label={
            isAdded
              ? `Add another ${productName} to cart`
              : `Add ${productName} to cart`
          }
          className={`absolute bottom-2 right-2 md:bottom-3 md:right-3 z-20 h-9 w-9 md:h-10 md:w-10 flex items-center justify-center rounded-full shadow-lg border transition-all duration-300 pointer-events-auto active:scale-95 overflow-visible ${
            isAdded
              ? 'bg-primary text-white border-primary'
              : 'bg-white text-gray-900 border-gray-100 md:hover:bg-primary md:hover:text-white md:hover:border-primary'
          }`}
        >
          {isAdded ? (
            <Check size={16} strokeWidth={3} />
          ) : (
            <ShoppingCart
              size={16}
              className={`transition-transform md:w-[18px] md:h-[18px] ${showPlusOne ? 'scale-90' : ''}`}
              strokeWidth={2}
            />
          )}
          {showPlusOne && (
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-primary font-bold text-sm animate-out fade-out slide-out-to-top-4 duration-1000 fill-mode-forwards z-30 pointer-events-none shadow-sm bg-white px-1.5 rounded-full border border-primary/20">
              +1
            </span>
          )}
        </button>
      )}
    </>
  );
}
