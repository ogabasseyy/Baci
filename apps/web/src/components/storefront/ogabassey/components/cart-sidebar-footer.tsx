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
  checkoutError,
  cartHref,
  onNegotiateTotal,
  onCheckout,
  onClose,
}: {
  total: number;
  hasPriceNegotiation: boolean;
  hasNonNegotiableCartItem: boolean;
  isCheckoutLoading: boolean;
  checkoutError?: string | null;
  cartHref: Route;
  onNegotiateTotal: () => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-store-border bg-store-background-text/5 p-6 space-y-4 shrink-0">
      <CartSidebarTotal total={total} />

      {/* Negotiate Total Button */}
      {hasPriceNegotiation && !hasNonNegotiableCartItem && (
        <button
          type="button"
          onClick={onNegotiateTotal}
          className="w-full bg-store-background-text/10 hover:bg-store-background-text/15 text-store-background-text font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-store-border"
        >
          <Calculator size={18} className="text-store-primary" />
          Negotiate Total Amount
        </button>
      )}

      <div>
        <button
          type="button"
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
        {checkoutError && (
          <p
            role="alert"
            className="text-xs text-red-600 font-medium text-center mt-2"
          >
            {checkoutError}
          </p>
        )}
      </div>

      <div className="text-center">
        <Link
          href={cartHref}
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold text-store-background-text/70 hover:text-store-background-text underline-offset-4 hover:underline"
        >
          View Full Cart
        </Link>
      </div>
    </div>
  );
}
