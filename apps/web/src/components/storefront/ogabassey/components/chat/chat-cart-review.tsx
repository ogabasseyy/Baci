'use client';

import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { SHARED_CART_MAX_QUANTITY_PER_LINE } from '@baci/shared/cart';
import { useCart } from '@/hooks/cart';
import { capUpdatedSimpleLineQuantity } from '@/hooks/cart/cart-stock-caps';
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

export function ChatCartReview() {
  const {
    cart,
    setIsCartOpen,
    isHydrated,
    merchantSlug,
    updateQuantity,
    removeFromCart,
  } = useCart();
  const { formatCurrency } = useCurrency();
  const merchant = useMerchantSafe()?.merchant;

  if (!isHydrated) {
    return (
      <div
        className="rounded-xl border border-store-border bg-store-background p-3 text-store-background-text"
      >
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
    <div
      className="rounded-xl border border-store-border bg-store-background p-3 text-store-background-text"
    >
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
          {displayCart.map((item) => {
            const cartLineIndex = cart.findIndex(
              (line) => line.cartItemId === item.cartItemId
            );
            const nextQuantity = capUpdatedSimpleLineQuantity({
              item,
              cart,
              excludeIndex: cartLineIndex,
              quantity: item.quantity + 1,
            });
            const nextQuantityAllowed =
              cartLineIndex >= 0 &&
              !('keepPrevious' in nextQuantity) &&
              nextQuantity.quantity > item.quantity;

            return (
              <li key={item.cartItemId} className="py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{item.name}</div>
                    <CartVariantDetails
                      item={item}
                      className="text-store-background-text/70"
                    />
                    <div className="mt-1 text-store-background-text/70">
                      {isQuizVoucherCartItem(item)
                        ? 'Free gift'
                        : `${item.quantity} × ${formatCurrency(getCartItemCheckoutUnitPrice(item))}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromCart(item.cartItemId)}
                    aria-label={`Remove ${item.name} from cart`}
                    className="shrink-0 rounded-md p-1.5 text-store-background-text/60 hover:bg-store-background-text/5 hover:text-store-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-store-primary"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                {!isQuizVoucherCartItem(item) && (
                  <div
                    className="mt-2 inline-flex h-8 items-center rounded-md border border-store-border"
                    aria-label={`Quantity for ${item.name}`}
                    role="group"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(item.cartItemId, item.quantity - 1)
                      }
                      disabled={
                        item.quantity <= (item.minimum_order_quantity ?? 1)
                      }
                      aria-label={`Decrease ${item.name} quantity`}
                      className="h-full rounded-l-md px-2 text-store-background-text/70 hover:bg-store-background-text/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-store-primary"
                    >
                      <Minus size={14} aria-hidden="true" />
                    </button>
                    <span className="min-w-8 px-1 text-center text-xs font-medium">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(item.cartItemId, item.quantity + 1)
                      }
                      disabled={
                        item.quantity >= SHARED_CART_MAX_QUANTITY_PER_LINE ||
                        !nextQuantityAllowed
                      }
                      aria-label={`Increase ${item.name} quantity`}
                      className="h-full rounded-r-md px-2 text-store-background-text/70 hover:bg-store-background-text/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-store-primary"
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
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
        </>
      )}
    </div>
  );
}
