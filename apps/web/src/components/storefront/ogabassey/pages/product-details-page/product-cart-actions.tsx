'use client';

import type { Route } from 'next';
import {
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldPlus,
  ShoppingCart,
  Trash2,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AssuranceDefaultNote } from './assurance-default-note';

interface ProductCartActionsProps {
  cartHref: Route;
  canPurchase: boolean;
  inputValue: string;
  onAddToCart: () => void;
  onDecrement: () => void;
  onIncrement: () => void;
  onInputBlur: () => void;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  quantityInCart: number;
}

export function ProductCartActions({
  cartHref,
  canPurchase,
  inputValue,
  onAddToCart,
  onDecrement,
  onIncrement,
  onInputBlur,
  onInputChange,
  onInputKeyDown,
  quantityInCart,
}: ProductCartActionsProps) {
  return (
    <>
      <div className="mb-8 hidden md:block">
        {quantityInCart > 0 ? (
          <div className="flex gap-3">
            <div className="flex h-14 flex-1 animate-in items-center justify-between overflow-hidden rounded-xl border-2 border-store-primary bg-white fade-in duration-200">
              <button
                type="button"
                onClick={onDecrement}
                className="flex h-full w-14 items-center justify-center border-r border-store-primary/15 text-store-primary transition-colors hover:bg-store-primary/5"
                aria-label={quantityInCart === 1 ? 'Remove item' : 'Decrease quantity'}
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
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={inputValue}
                  onChange={onInputChange}
                  onBlur={onInputBlur}
                  onKeyDown={onInputKeyDown}
                  disabled={!canPurchase}
                  className="w-12 border-none bg-transparent p-0 text-center text-lg font-bold text-gray-900 outline-hidden focus:border-none focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0"
                  aria-label="Quantity"
                />
              </div>
              <button
                type="button"
                onClick={onIncrement}
                disabled={!canPurchase}
                className="flex h-full w-14 items-center justify-center border-l border-store-primary/15 text-store-primary transition-colors hover:bg-store-primary/5"
                aria-label="Increase quantity"
              >
                <Plus size={20} />
              </button>
            </div>
            <Link
              href={cartHref}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-store-primary font-bold text-store-primary-text shadow-lg transition-all hover:bg-store-primary/90 hover:shadow-store-primary/20"
            >
              <ShoppingCart size={20} />
              View Cart
            </Link>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onAddToCart}
              disabled={!canPurchase}
              className={cn(
                'flex h-14 w-full items-center justify-center gap-2 rounded-xl font-bold shadow-lg transition-all',
                canPurchase
                  ? 'bg-store-primary text-store-primary-text hover:bg-store-primary/90 hover:shadow-store-primary/20'
                  : 'cursor-not-allowed bg-store-background-text/10 text-store-background-text/45 shadow-none'
              )}
            >
              {canPurchase ? 'Add to Cart' : 'Unavailable'}
            </button>
            <AssuranceDefaultNote
              canPurchase={canPurchase}
              quantityInCart={quantityInCart}
              className="mt-2 text-center text-xs text-gray-500"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <Truck size={16} className="shrink-0 text-store-primary" />
          <div className="text-xs">
            <span className="block font-bold text-gray-900">
              Nationwide Delivery
            </span>
            <span className="text-gray-500">All states covered</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <RotateCcw
            size={16}
            className="shrink-0 text-store-primary"
          />
          <div className="text-xs">
            <span className="block font-bold text-gray-900">14 Day Returns</span>
            <span className="text-gray-500">Easy return policy</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <ShieldCheck
            size={16}
            className="shrink-0 text-store-primary"
          />
          <div className="text-xs">
            <span className="block font-bold text-gray-900">1 Year Warranty</span>
            <span className="text-gray-500">Official coverage</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <ShieldPlus
            size={16}
            className="shrink-0 text-store-primary"
          />
          <div className="text-xs">
            <span className="block font-bold text-gray-900">
              Device Protection
            </span>
            <span className="text-gray-500">Coverage available</span>
          </div>
        </div>
      </div>
    </>
  );
}
