'use client';

import type { Route } from 'next';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { AssuranceDefaultNote } from './assurance-default-note';

interface ProductMobileActionBarProps {
  cartHref: Route;
  canPurchase: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
  onMobileAddToCart: (startRect: DOMRect) => void;
  quantityInCart: number;
}

export function ProductMobileActionBar({
  cartHref,
  canPurchase,
  onDecrement,
  onIncrement,
  onMobileAddToCart,
  quantityInCart,
}: ProductMobileActionBarProps) {
  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 border-t border-gray-200 bg-white p-3 shadow-[0_-5px_20px_rgba(0,0,0,0.1)] md:hidden">
      {quantityInCart > 0 ? (
        <div className="flex gap-3">
          <div className="flex h-14 flex-1 items-center justify-between rounded-xl border-2 border-store-primary bg-white">
            <button
              type="button"
              onClick={onDecrement}
              className="flex h-full w-14 items-center justify-center rounded-l-xl border-r border-store-primary/15 text-store-primary active:bg-store-primary/5"
              aria-label={
                quantityInCart === 1 ? 'Remove item' : 'Decrease quantity'
              }
            >
              {quantityInCart === 1 ? (
                <Trash2 size={20} />
              ) : (
                <Minus size={20} />
              )}
            </button>
            <div className="flex flex-1 flex-col items-center justify-center">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                In Cart
              </span>
              <span className="text-lg font-bold text-gray-900">
                {quantityInCart}
              </span>
            </div>
            <button
              type="button"
              onClick={canPurchase ? onIncrement : undefined}
              disabled={!canPurchase}
              aria-disabled={!canPurchase}
              className="flex h-full w-14 items-center justify-center rounded-r-xl border-l border-store-primary/15 text-store-primary active:bg-store-primary/5"
              aria-label="Increase quantity"
            >
              <Plus size={20} />
            </button>
          </div>
          <Link
            href={cartHref}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-store-primary font-bold text-store-primary-text shadow-lg transition-all active:scale-[0.98] active:bg-store-primary/90 active:shadow-none"
          >
            <ShoppingCart size={20} />
            View Cart
          </Link>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={(event) =>
              onMobileAddToCart(event.currentTarget.getBoundingClientRect())
            }
            disabled={!canPurchase}
            aria-label={canPurchase ? 'Add this product to cart' : 'Product out of stock'}
            className={`flex h-14 w-full items-center justify-center gap-2 rounded-xl font-bold shadow-lg transition-all ${
              canPurchase
                ? 'bg-store-primary text-store-primary-text active:scale-[0.98] active:bg-store-primary/90 active:shadow-none'
                : 'cursor-not-allowed bg-store-background-text/10 text-store-background-text/45 shadow-none'
            }`}
          >
            <ShoppingCart size={20} />
            {canPurchase ? 'Add to Cart' : 'Out of Stock'}
          </button>
          <AssuranceDefaultNote
            canPurchase={canPurchase}
            quantityInCart={quantityInCart}
            className="mt-2 text-center text-xs text-store-background-text/60"
          />
        </>
      )}
    </div>
  );
}
