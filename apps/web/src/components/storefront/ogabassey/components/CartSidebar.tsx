'use client';

import { ShoppingBag, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { analytics } from '@/lib/analytics';
import { asRoute } from '@/lib/routes';
import { AdUnit } from './AdUnit';
// import { ActionTooltip } from './Tooltip';
import { hasCartMerchantContext } from './cart-sidebar-merchant-context';
import { CartSidebarFooter } from './cart-sidebar-footer';
import { CheckoutIdentityModal } from './CheckoutIdentityModal';
import { useCartCheckout } from './use-cart-checkout';
import { CartSidebarLineItem } from './cart-sidebar-line-item';
import { EmptyState } from './empty-state';
import {
  deriveCartLineNegotiationProps,
  NegotiationModal,
} from './NegotiationModal';
import { useCartSidebarNegotiation } from './use-cart-sidebar-negotiation';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { isProductNegotiable } from '@baci/shared/lib';
import {
  calculateCartTotal,
  isQuizVoucherCartItem,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';

export const CartSidebar: React.FC = () => {
  const {
    isCartOpen,
    setIsCartOpen,
    cart,
    removeFromCart,
    updateQuantity,
    applyNegotiatedPrice,
    applyCartWideNegotiation,
    clearNegotiatedPrice,
    toggleAssurance,
    merchantSlug: cartMerchantSlug,
  } = useCart();

  // Get merchant context for slug
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const cartMerchantContextMatches = hasCartMerchantContext(
    cartMerchantSlug,
    merchant?.slug
  );
  const basePath =
    cartMerchantSlug && !cartMerchantContextMatches
      ? `/${cartMerchantSlug}`
      : merchantContext?.basePath;
  const negotiationVatRate =
    cartMerchantContextMatches &&
    merchant?.vat_registration_status === 'registered'
      ? (merchant.vat_rate ?? 7.5) / 100
      : 0;

  const hasPriceNegotiation =
    cartMerchantContextMatches && hasStorefrontPriceNegotiation(merchant);

  const displayCart = sanitizeCartItems(cart, hasPriceNegotiation);

  const displayCartTotal = calculateCartTotal(cart, hasPriceNegotiation);

  const hasNonNegotiableCartItem = displayCart.some(
    (item) =>
      !isQuizVoucherCartItem(item) &&
      !isProductNegotiable({ brand: item.brand, name: item.name })
  );

  const getHref = (path: string) =>
    path.startsWith('http') ? path : `${basePath || ''}${path === '/' ? '' : path}`;

  const {
    closeCart,
    handleCheckout,
    isCheckoutLoading,
    isIdentityOpen,
    setIsIdentityOpen,
    checkoutError,
  } = useCartCheckout(isCartOpen, setIsCartOpen, getHref('/checkout'));

  const {
    negotiationState,
    handleNegotiationSuccess,
    openItemNegotiation,
    openTotalNegotiation,
    closeNegotiation,
  } = useCartSidebarNegotiation({
    cart,
    cartTotal: displayCartTotal,
    hasNonNegotiableCartItem,
    applyNegotiatedPrice,
    applyCartWideNegotiation,
    clearNegotiatedPrice,
  });

  /* eslint-enable @typescript-eslint/no-unused-vars */

  const lastCartView = useRef<string | null>(null);
  useEffect(() => {
    if (!isCartOpen || displayCart.length === 0) {
      lastCartView.current = null;
      return;
    }
    if (isCartOpen && displayCart.length > 0 && cartMerchantContextMatches) {
      const fingerprint = JSON.stringify([
        merchant?.id,
        merchant?.payout_currency ?? 'NGN',
        displayCart.map((item) => JSON.stringify([
          item.id, item.variantId ?? null, item.offerId ?? null, item.condition ?? null,
          Object.entries(item.variantAttributes ?? {}).sort(([a], [b]) => a.localeCompare(b)),
          item.selectedColor ?? null, item.selectedStorage ?? null, item.quantity, item.price,
        ])).sort(),
      ]);
      if (lastCartView.current === fingerprint) return;
      lastCartView.current = fingerprint;
      const analyticsProducts = displayCart.map((item) => ({
        product: item,
        quantity: item.quantity,
      }));
      analytics.viewCart(analyticsProducts, merchant?.payout_currency ?? 'NGN', {
        merchantId: merchant?.id || '',
      });
    }
  }, [isCartOpen, cart, cartMerchantContextMatches, merchant?.id, merchant?.payout_currency]);

  if (!isCartOpen) return null;

  const handleClose = closeCart;

  return (
    <>
      {/* Keep all cart actions above the mobile footer (z-70). */}
      <div className="fixed inset-0 z-80 overflow-hidden">
        {/* Backdrop */}
        <button
          type="button"
          aria-label="Dismiss cart backdrop"
          tabIndex={-1}
          className="absolute inset-0 border-0 bg-black/50 p-0 backdrop-blur-xs transition-opacity"
          onClick={closeCart}
        />

        {/* Sidebar Panel - SWIPES FROM RIGHT */}
        <div className="absolute inset-y-0 right-0 max-w-full flex">
          <div className="w-screen max-w-md bg-store-background shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-4 sm:px-6 py-4 border-b border-store-border flex items-center justify-between bg-store-background shrink-0">
              <h2 className="text-xl font-bold text-store-background-text flex items-center gap-2">
                <ShoppingBag className="text-store-primary" />
                Your Cart
                <span className="text-sm font-medium text-store-background-text/60 ml-2">
                  ({displayCart.length} items)
                </span>
              </h2>
              <button
                type="button"
                onClick={closeCart}
                className="p-2 hover:bg-store-background-text/10 rounded-full transition-colors text-store-background-text/60 hover:text-store-primary"
                aria-label="Close cart"
              >
                <X size={24} />
              </button>
            </div>

            {/* Cart Items List */}
            <div
              className={`flex-1 overflow-y-auto p-4 sm:p-6 bg-store-background-text/5 ${displayCart.length === 0 ? 'flex flex-col' : 'space-y-4'}`}
            >
              {displayCart.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <EmptyState
                    variant="cart"
                    title="Your cart is empty"
                    description="Add an item to your cart and it will appear here."
                    actionLabel="Start Shopping"
                    onAction={closeCart}
                  />
                </div>
              ) : (
                <>
                  {displayCart.map((item) => (
                    <CartSidebarLineItem
                      key={item.cartItemId}
                      item={item}
                      basePath={basePath}
                      hasPriceNegotiation={hasPriceNegotiation}
                      cartMerchantContextMatches={cartMerchantContextMatches}
                      merchantSlug={merchant?.slug}
                      shippingInsuranceEnabled={
                        merchant?.feature_settings
                          ?.shipping_insurance_enabled
                      }
                      onRemove={removeFromCart}
                      onUpdateQuantity={updateQuantity}
                      onNegotiate={openItemNegotiation}
                      onToggleAssurance={toggleAssurance}
                    />
                  ))}

                  {/* Dynamic Ad Placement in Cart */}
                  <div className="mt-8 border-t border-store-border pt-4">
                    <AdUnit placementKey="CART_MPU" />
                  </div>
                </>
              )}
            </div>

            {/* Cart totals; delivery costs are handled in checkout. */}
            {displayCart.length > 0 && (
              <CartSidebarFooter
                total={displayCartTotal}
                hasPriceNegotiation={hasPriceNegotiation}
                hasNonNegotiableCartItem={hasNonNegotiableCartItem}
                isCheckoutLoading={isCheckoutLoading}
                checkoutError={checkoutError}
                cartHref={asRoute(getHref('/cart'))}
                onNegotiateTotal={openTotalNegotiation}
                onCheckout={handleCheckout}
                onClose={handleClose}
              />
            )}
          </div>
        </div>
      </div>

      <CheckoutIdentityModal isOpen={isIdentityOpen} onClose={() => setIsIdentityOpen(false)} checkoutUrl={getHref('/checkout')} onProceed={closeCart} />
      {/* Negotiation Modal — only render when merchant context is available */}
      {negotiationState && cartMerchantContextMatches && merchant?.id && (
        <NegotiationModal
          isOpen={negotiationState.isOpen}
          onClose={closeNegotiation}
          productName={negotiationState.name}
          currentPrice={negotiationState.currentPrice}
          vatRate={negotiationVatRate}
          onSuccess={handleNegotiationSuccess}
          type={negotiationState.type}
          merchantId={merchant.id}
          cart={cart}
          {...(negotiationState.type === 'single' && negotiationState.item
            ? deriveCartLineNegotiationProps(negotiationState.item)
            : {})}
        />
      )}
    </>
  );
};
