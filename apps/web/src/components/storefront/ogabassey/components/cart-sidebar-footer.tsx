'use client';

import { ArrowRight, Calculator } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { CartSidebarTotal } from './cart-sidebar-total';

export function CartSidebarFooter({
  total,
  hasPriceNegotiation,
  hasNonNegotiableCartItem,
  isCheckoutLoading,
  cartHref,
  onNegotiateTotal,
  onCheckout,
  onClose,
}: {
  total: number;
  hasPriceNegotiation: boolean;
  hasNonNegotiableCartItem: boolean;
  isCheckoutLoading: boolean;
  cartHref: Route;
  onNegotiateTotal: () => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-gray-100 bg-gray-50 p-6 space-y-4 shrink-0">
      <CartSidebarTotal total={total} />

      {/* Negotiate Total Button */}
      {hasPriceNegotiation && !hasNonNegotiableCartItem && (
        <button type="button"
          onClick={onNegotiateTotal}
          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-200"
        >
          <Calculator size={18} className="text-store-primary" />
          Negotiate Total Amount
        </button>
      )}

      <button type="button"
        onClick={onCheckout}
        disabled={isCheckoutLoading}
        className="w-full bg-store-primary hover:bg-store-primary/90 text-store-primary-text font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg group disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {isCheckoutLoading ? (
          <div className="size-5 border-2 border-store-primary-text/30 border-t-store-primary-text rounded-full animate-spin" />
        ) : (
          <>
            Proceed to Checkout
            <ArrowRight
              size={20}
              className="group-hover:translate-x-1 transition-transform"
            />
          </>
        )}
      </button>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href={cartHref}
          onClick={onClose}
          className="w-full bg-white hover:bg-gray-50 text-gray-900 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-200 active:bg-gray-50 text-sm"
        >
          View Full Cart
        </Link>
        <button type="button"
          onClick={onClose}
          className="w-full text-center text-gray-500 hover:text-gray-900 text-sm font-medium py-3.5 px-4 rounded-xl hover:bg-gray-50 transition-colors"
        >
          Continue Shopping
        </button>
      </div>
    </div>
  );
}
