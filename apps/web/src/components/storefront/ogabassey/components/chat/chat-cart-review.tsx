'use client';

import { ShoppingBag } from 'lucide-react';
import { type CartItem, useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  calculateCartTotal,
  isQuizVoucherCartItem,
  getCartItemCheckoutUnitPrice,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { CartVariantDetails } from '../cart-variant-details';
import { hasCartMerchantContext } from '../cart-sidebar-merchant-context';
import { ChatCartCheckoutReview } from './chat-cart-checkout-review';

export function ChatCartReview() {
  const {
    cart,
    setIsCartOpen,
    isHydrated,
    merchantSlug,
    sharedCartEnabled,
    sharedCartRef,
    syncStatus,
    refreshSharedCart,
  } = useCart();
  const { formatCurrency, currencyCode } = useCurrency();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;

  if (!isHydrated) {
    return (
      <div className="rounded-xl border border-store-border bg-store-background p-3 text-store-background-text">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <ShoppingBag size={16} aria-hidden="true" />
          <h4>Review your cart</h4>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="py-2 text-sm text-store-background-text/70"
        >
          Loading cart…
        </p>
      </div>
    );
  }

  const hasPriceNegotiation =
    hasCartMerchantContext(merchantSlug, merchant?.slug) &&
    hasStorefrontPriceNegotiation(merchant);
  const displayCart = sanitizeCartItems(cart, hasPriceNegotiation);
  const estimatedCartTotal = calculateCartTotal(
    displayCart,
    hasPriceNegotiation
  );
  const includesProtection = displayCart.some((item) => item.hasAssurance);

  return (
    <div className="rounded-xl border border-store-border bg-store-background p-3 text-store-background-text">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <ShoppingBag size={16} aria-hidden="true" />
        <h4>Review your cart</h4>
      </div>

      {displayCart.length === 0 ? (
        <p className="py-2 text-sm text-store-background-text/70">
          Your cart is empty
        </p>
      ) : (
        <ul className="divide-y divide-store-border">
          {displayCart.map((item: CartItem) => (
            <li key={item.cartItemId} className="py-2 text-sm">
              <div className="font-medium">{item.name}</div>
              <CartVariantDetails
                item={item}
                className="text-store-background-text/70"
              />
              <div className="text-store-background-text/70">
                {isQuizVoucherCartItem(item)
                  ? 'Free gift'
                  : `${item.quantity} × ${formatCurrency(getCartItemCheckoutUnitPrice(item))}`}
              </div>
            </li>
          ))}
        </ul>
      )}

      {displayCart.length > 0 && (
        <>
          <div className="mt-2 border-t border-store-border pt-2">
            <div className="flex justify-between gap-3 text-sm font-semibold">
              <span>Estimated subtotal</span>
              <span>{formatCurrency(estimatedCartTotal)}</span>
            </div>
            <p className="mt-1 text-xs text-store-background-text/60">
              {includesProtection && 'Includes selected protection. '}
              Shipping, tax, and final total are determined during checkout.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="mt-3 w-full rounded-lg border border-store-primary px-3 py-2 text-sm font-medium text-store-primary hover:bg-store-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary"
          >
            Open cart to edit items
          </button>
          <ChatCartCheckoutReview
            items={displayCart}
            merchantId={merchant?.id}
            merchantSlug={merchantSlug}
            currencyCode={currencyCode}
            sharedCartEnabled={sharedCartEnabled}
            sharedCartRef={sharedCartRef}
            syncStatus={syncStatus}
            refreshSharedCart={refreshSharedCart}
          />
        </>
      )}
    </div>
  );
}
