'use client';

import {
  ArrowRight,
  Calculator,
  Check,
  HandCoins,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type React from 'react';
import { useState, useEffect } from 'react';
import { type CartItem, useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { analytics } from '@/lib/analytics';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { AdUnit } from './AdUnit';
import { CartSidebarTotal } from './cart-sidebar-total';
// import { ActionTooltip } from './Tooltip';
import { EmptyState } from './empty-state';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import {
  deriveCartLineNegotiationProps,
  NegotiationModal,
} from './NegotiationModal';
import { runCartTotalNegotiation } from '../lib/cart-total-negotiation';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { isProductNegotiable } from '@baci/shared/lib';
import {
  calculateCartTotal,
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';

// Helper type to manage modal state more cleanly
interface NegotiationState {
  isOpen: boolean;
  type: 'single' | 'total';
  item?: CartItem; // Present if type is 'single'
  currentPrice: number;
  name: string;
}

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
  } = useCart();

  const [negotiationState, setNegotiationState] =
    useState<NegotiationState | null>(null);

  // Get merchant context for slug
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const basePath = merchantContext?.basePath;
  const negotiationVatRate =
    merchant?.vat_registration_status === 'registered'
      ? (merchant.vat_rate ?? 7.5) / 100
      : 0;

  const hasPriceNegotiation = hasStorefrontPriceNegotiation(merchant);

  const displayCart = sanitizeCartItems(cart, hasPriceNegotiation);

  const displayCartTotal = calculateCartTotal(cart, hasPriceNegotiation);

  const hasNonNegotiableCartItem = displayCart.some(
    (item) =>
      !isQuizVoucherCartItem(item) &&
      !isProductNegotiable({ brand: item.brand, name: item.name })
  );

  const getHref = (path: string) =>
    path.startsWith('http') ? path : `${basePath || ''}${path === '/' ? '' : path}`;

  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const router = useRouter();

  /* eslint-enable @typescript-eslint/no-unused-vars */

  // Track ViewCart event when sidebar opens
  useEffect(() => {
    if (isCartOpen && displayCart.length > 0) {
      // Map cart items to Product structure expected by analytics
      const analyticsProducts = displayCart.map((item) => ({
        product: {
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          brand: item.brand,
        } as any, // Cast to avoid full Product type mismatch if needed
        quantity: item.quantity,
      }));

      analytics.viewCart(analyticsProducts, 'NGN', {
        merchantId: merchant?.id || '',
        // If we had user data context, we would pass it here
        // userData: { email: user?.email, ... }
      });
    }
  }, [isCartOpen, cart, merchant?.id]);

  if (!isCartOpen) return null;

  const handleNegotiationSuccess = (finalPrice: number) => {
    if (!negotiationState) return;

    if (negotiationState.type === 'single' && negotiationState.item) {
      // finalPrice is the negotiated TOTAL for the line item (Unit Price * Quantity)
      const quantity = negotiationState.item.quantity;
      const newUnitPrice = finalPrice / quantity;
      applyNegotiatedPrice?.(negotiationState.item.cartItemId, newUnitPrice);
    } else if (negotiationState.type === 'total') {
      applyCartWideNegotiation?.(finalPrice);
    }
  };

  const openItemNegotiation = (item: CartItem) => {
    if (!isProductNegotiable({ brand: item.brand, name: item.name })) {
      return;
    }

    const currentUnitPrice = item.negotiatedPrice || item.price || 0;
    const currentTotal = currentUnitPrice * item.quantity;

    setNegotiationState({
      isOpen: true,
      type: 'single',
      item: item,
      currentPrice: currentTotal,
      name: item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name,
    });
  };

  const openTotalNegotiation = () => {
    if (hasNonNegotiableCartItem) {
      return;
    }

    runCartTotalNegotiation({
      cart,
      fallbackTotal: displayCartTotal,
      clearNegotiatedPrice,
      confirmReset: () =>
        window.confirm(
          'Negotiating your whole cart will clear the prices you negotiated on individual items. Reset them and continue?'
        ),
      openBulk: (currentPrice) =>
        setNegotiationState({
          isOpen: true,
          type: 'total',
          currentPrice,
          name: 'Entire Cart',
        }),
    });
  };

  return (
    <>
      {/* High Z-Index to cover Mobile Footer (z-40) */}
      <div className="fixed inset-0 z-60 overflow-hidden">
        {/* Backdrop */}
        <button
          type="button"
          aria-label="Dismiss cart backdrop"
          tabIndex={-1}
          className="absolute inset-0 border-0 bg-black/50 p-0 backdrop-blur-xs transition-opacity"
          onClick={() => setIsCartOpen(false)}
        />

        {/* Sidebar Panel - SWIPES FROM RIGHT */}
        <div className="absolute inset-y-0 right-0 max-w-full flex">
          <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ShoppingBag className="text-red-600" />
                Your Cart
                <span className="text-sm font-medium text-gray-500 ml-2">
                  ({displayCart.length} items)
                </span>
              </h2>
              <button type="button"
                onClick={() => setIsCartOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-red-600"
                aria-label="Close cart"
              >
                <X size={24} />
              </button>
            </div>

            {/* Cart Items List */}
            <div
              className={`flex-1 overflow-y-auto p-6 ${displayCart.length === 0 ? 'flex flex-col' : 'space-y-6'}`}
            >
              {displayCart.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <EmptyState
                    variant="cart"
                    title="Your cart is empty"
                    description="Add an item to your cart and it will appear here."
                    actionLabel="Start Shopping"
                    onAction={() => setIsCartOpen(false)}
                  />
                </div>
              ) : (
                <>
                  {displayCart.map((item) => {
                    const productHref = asRoute(
                      getStorefrontProductHref(item, basePath || '')
                    );
                    const isQuizGift = isQuizVoucherCartItem(item);
                    const priceToUse = getCartItemCheckoutUnitPrice(item);
                    const itemTotal = priceToUse * item.quantity;
                    const assuranceRate =
                      item.assuranceRate ?? DEFAULT_ASSURANCE_RATE;
                    const assuranceRateLabel = `${Number(
                      (assuranceRate * 100).toFixed(2)
                    )}%`;
                    const assuranceCost =
                      itemTotal * assuranceRate;

                    return (
                      <div
                        key={item.cartItemId}
                        className="flex gap-4 animate-in fade-in duration-300 border-b border-gray-50 pb-6 last:border-0 last:pb-0"
                      >
                        <Link
                          href={productHref}
                          className="ogabassey-product-card-image-surface relative size-24 bg-gray-50 rounded-lg border border-gray-100 p-2 shrink-0 self-start mt-1 block group/image"
                        >
                          <CdnFormatImage
                            src={item.image || '/placeholder.png'}
                            alt={item.name}
                            fill
                            sizes="96px"
                            className="object-contain mix-blend-multiply p-1"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = '/placeholder.png';
                            }}
                          />
                          {/* Condition Badge - Bottom Center Overlay */}
                          {item.condition && (
                            <span
                              className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-sm uppercase tracking-wider whitespace-nowrap z-10 ${item.condition?.toLowerCase() === 'new'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                                }`}
                            >
                              {item.condition}
                            </span>
                          )}
                        </Link>
                        <div className="flex-1 flex flex-col justify-between min-h-[100px]">
                          <div>
                            <div className="flex justify-between items-start">
                              <Link
                                href={productHref}
                                className="font-bold text-gray-900 line-clamp-1 text-sm hover:text-red-600 transition-colors"
                              >
                                {item.name}
                              </Link>
                              <button type="button"
                                onClick={() => removeFromCart(item.cartItemId)}
                                className="text-gray-400 hover:text-red-600 p-1 -mt-1 -mr-1"
                                aria-label="Remove item"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>

                            {/* Item Details: Color & Storage */}
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              {/* Removed Condition from here, moved to image overlay */}

                              {/* Color & Storage */}
                              <div className="text-xs text-gray-500 flex items-center gap-1">
                                {item.selectedColor && (
                                  <span className="flex items-center gap-1">
                                    <span
                                      className="size-2.5 rounded-full border border-gray-300 shadow-sm"
                                      style={{
                                        backgroundColor:
                                          item.selectedColorValue ||
                                          item.selectedColor,
                                      }}
                                    />
                                    {item.selectedColor}
                                  </span>
                                )}
                                {item.secondaryColor && (
                                  <span className="text-[10px] text-blue-500">
                                    (Pref 2: {item.secondaryColor})
                                  </span>
                                )}
                                {item.selectedStorage && (
                                  <>
                                    <span>•</span>
                                    <span>{item.selectedStorage}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* BOTTOM ROW: Quantity/Negotiate (Left) | Price (Right) */}
                          <div className="flex items-end justify-between mt-3">
                            <div className="flex flex-col gap-3">
                              {/* Quantity */}
                              <div className="flex items-center border border-gray-200 rounded-md w-fit">
                                <button type="button"
                                  onClick={() =>
                                    updateQuantity(
                                      item.cartItemId,
                                      item.quantity - 1
                                    )
                                  }
                                  className="p-1 px-2 hover:bg-gray-50 text-gray-500"
                                  disabled={item.quantity <= 1}
                                  aria-label="Decrease quantity"
                                >
                                  <Minus size={12} />
                                </button>
                                <span className="w-6 text-center text-xs font-medium">
                                  {item.quantity}
                                </span>
                                <button type="button"
                                  onClick={() =>
                                    updateQuantity(
                                      item.cartItemId,
                                      item.quantity + 1
                                    )
                                  }
                                  className="p-1 px-2 hover:bg-gray-50 text-gray-500"
                                  aria-label="Increase quantity"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>

                              {/* Negotiation - Bottom Left */}
                              {hasPriceNegotiation && !isQuizGift && (
                                item.negotiationStatus === 'accepted' ? (
                                  <div className="flex items-center gap-1 text-[10px] font-bold text-store-primary bg-store-primary/5 px-1.5 py-0.5 rounded-md w-fit border border-store-primary/15">
                                    <Check size={10} strokeWidth={3} />
                                    <span>
                                      Matched @ ₦
                                      {item.negotiatedPrice?.toLocaleString()}
                                    </span>
                                  </div>
                                ) : isProductNegotiable({
                                    brand: item.brand,
                                    name: item.name,
                                  }) ? (
                                  <button type="button"
                                    onClick={() => openItemNegotiation(item)}
                                    className="flex items-center gap-1.5 text-[10px] font-bold text-store-primary hover:text-store-primary transition-colors"
                                  >
                                    <HandCoins size={14} />
                                    <span>Negotiate</span>
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-md w-fit border border-gray-200">
                                    <Check size={10} strokeWidth={3} />
                                    <span>Best price</span>
                                  </div>
                                )
                              )}
                            </div>

                            <div className="text-right pb-0.5">
                              {isQuizGift ? (
                                <div className="font-bold text-store-primary text-sm">
                                  Free gift
                                </div>
                              ) : item.negotiatedPrice ? (
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] text-store-background-text/45 line-through decoration-store-primary/40">
                                    ₦
                                    {(
                                      item.price * item.quantity
                                    ).toLocaleString()}
                                  </span>
                                  <span className="font-bold text-store-primary text-sm">
                                    ₦{itemTotal.toLocaleString()}
                                  </span>
                                </div>
                              ) : (
                                <div className="font-bold text-gray-900 text-sm">
                                  ₦{itemTotal.toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Assurance/Insurance Toggle */}
                          {merchant?.feature_settings?.shipping_insurance_enabled && (
                            <div className="mt-4 pt-3 border-t border-gray-50">
                              <label className="flex items-start gap-2 cursor-pointer group">
                                <div className="relative flex items-center mt-0.5">
                                  <input
                                    type="checkbox"
                                    checked={item.hasAssurance || false}
                                    onChange={() =>
                                      toggleAssurance?.(item.cartItemId)
                                    }
                                    className="peer sr-only"
                                  />
                                  <div className="w-9 h-5 bg-store-background-text/20 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-store-primary-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-store-background after:border-store-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-store-primary" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                                      <ShieldCheck
                                        size={12}
                                        className="text-red-600"
                                      />
                                      {merchant?.slug === 'ogabassey' ? 'Ogabassey Assurance' : 'Order Protection'}
                                    </span>
                                    {item.hasAssurance && (
                                      <span className="text-xs font-bold text-gray-900">
                                        +₦{assuranceCost.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                                    {item.hasAssurance ? (
                                      <>
                                        {merchant?.slug === 'ogabassey' ? (
                                          <>
                                            Covers <span className="font-bold text-gray-700">Screen & Liquid Damage</span>
                                          </>
                                        ) : (
                                          'Standard Shipping Protection'
                                        )}
                                      </>
                                    ) : (
                                      `${merchant?.slug === 'ogabassey' ? 'Device Protection' : 'Safety & Shipping Coverage'} (+${assuranceRateLabel})`
                                    )}
                                  </p>
                                </div>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Dynamic Ad Placement in Cart */}
                  <div className="mt-8 border-t border-gray-100 pt-4">
                    <AdUnit placementKey="CART_MPU" />
                  </div>
                </>
              )}
            </div>

            {/* Footer / Checkout */}
            {displayCart.length > 0 && (
              <div className="border-t border-gray-100 bg-gray-50 p-6 space-y-4 shrink-0">
                <CartSidebarTotal total={displayCartTotal} />

                {/* Negotiate Total Button */}
                {hasPriceNegotiation && !hasNonNegotiableCartItem && (
                  <button type="button"
                    onClick={openTotalNegotiation}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-200"
                  >
                    <Calculator size={18} className="text-red-600" />
                    Negotiate Total Amount
                  </button>
                )}

                <button type="button"
                  onClick={async () => {
                    setIsCheckoutLoading(true);
                    // Close the sidebar first to prevent it staying open
                    setIsCartOpen(false);
                    // Navigate to checkout
                    router.push(asRoute(getHref('/checkout')));
                    // Reset loading state after a delay (in case user comes back)
                    setTimeout(() => {
                      setIsCheckoutLoading(false);
                    }, 2000);
                  }}
                  disabled={isCheckoutLoading}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-red-200 group disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isCheckoutLoading ? (
                    <div className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                    href={asRoute(getHref('/cart'))}
                    onClick={() => setIsCartOpen(false)}
                    className="w-full bg-white hover:bg-gray-50 text-gray-900 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-200 active:bg-gray-50 text-sm"
                  >
                    View Full Cart
                  </Link>
                  <button type="button"
                    onClick={() => setIsCartOpen(false)}
                    className="w-full text-center text-gray-500 hover:text-gray-900 text-sm font-medium py-3.5 px-4 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Continue Shopping
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Negotiation Modal — only render when merchant context is available */}
      {negotiationState && merchant?.id && (
        <NegotiationModal
          isOpen={negotiationState.isOpen}
          onClose={() => setNegotiationState(null)}
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
