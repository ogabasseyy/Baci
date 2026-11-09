'use client';

import { CartPageCard } from './cart-page-card';
// Template preview

import {
  ArrowRight,
  Calculator,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useState } from 'react';
import { isProductNegotiable } from '@baci/shared/lib';
import { type CartItem, useCart } from '@/hooks/cart';
import { isQuizVoucherCartItem } from '@/lib/checkout/cart-entitlement-sanitizer';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { AdUnit } from '../components/AdUnit';
import {
  deriveCartLineNegotiationProps,
  NegotiationModal,
} from '../components/NegotiationModal';
import { runCartTotalNegotiation } from '../lib/cart-total-negotiation';
import { CartEmptyState } from './cart-empty-state';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { hasCartMerchantContext } from '../components/cart-sidebar-merchant-context';

interface NegotiationState {
  isOpen: boolean;
  type: 'single' | 'total';
  item?: CartItem;
  currentPrice: number;
  name: string;
}

interface OgabasseyV2CartPageProps {
  storeSlug?: string;
}

export const OgabasseyV2CartPage: React.FC<OgabasseyV2CartPageProps> = ({
  storeSlug,
}) => {
  const {
    cart,
    removeFromCart,
    updateQuantity,
    applyNegotiatedPrice,
    applyCartWideNegotiation,
    clearNegotiatedPrice,
    toggleAssurance,
    cartTotal,
    merchantSlug: cartMerchantSlug,
  } = useCart();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const cartMerchantContextMatches = hasCartMerchantContext(
    cartMerchantSlug,
    merchant?.slug
  );
  const shippingInsuranceEnabled = Boolean(
    merchant?.feature_settings?.shipping_insurance_enabled
  );
  const basePath = merchantContext?.basePath ?? `/${storeSlug || 'ogabassey'}`;
  const negotiationVatRate =
    merchant?.vat_registration_status === 'registered'
      ? (merchant.vat_rate ?? 7.5) / 100
      : 0;
  const [negotiationState, setNegotiationState] =
    useState<NegotiationState | null>(null);
  const _router = useRouter();

  const hasPriceNegotiation = Boolean(
    merchantContext?.merchant &&
      hasStorefrontPriceNegotiation(merchantContext.merchant)
  );

  const hasNonNegotiableCartItem = cart.some(
    (item) =>
      !isQuizVoucherCartItem(item) &&
      !isProductNegotiable({ brand: item.brand, name: item.name })
  );

  // Calculate subtotal

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleNegotiationSuccess = (finalPrice: number) => {
    if (!negotiationState) return;

    if (negotiationState.type === 'single' && negotiationState.item) {
      // finalPrice is the negotiated TOTAL for the line item (Unit Price * Quantity)
      // We need to convert it back to Unit Price for the system
      const quantity = negotiationState.item.quantity;
      const newUnitPrice = finalPrice / quantity;
      applyNegotiatedPrice?.(negotiationState.item.cartItemId, newUnitPrice);
    } else if (negotiationState.type === 'total') {
      applyCartWideNegotiation?.(finalPrice);
    }
    setNegotiationState(null);
  };

  const openItemNegotiation = (item: CartItem) => {
    if (!isProductNegotiable({ brand: item.brand, name: item.name })) {
      return;
    }

    const currentUnitPrice = item.negotiatedPrice || item.price;
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
      fallbackTotal: cartTotal,
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
    <div className="min-h-screen bg-store-background-text/5 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center mb-6 shrink-0">
          <h1 className="text-2xl font-bold text-store-background-text flex items-center gap-2">
            <ShoppingCart className="text-store-primary fill-store-primary" />
            Cart{' '}
            <span className="text-store-background-text/40 text-lg font-medium">
              ({cart.length})
            </span>
          </h1>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex items-start justify-center pb-20">
            <CartEmptyState basePath={basePath || '/'} />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
            {/* Cart Items List */}
            <div className="lg:col-span-8 space-y-4">
              {cart.map((item) => (
                <CartPageCard
                  basePath={basePath}
                  hasPriceNegotiation={hasPriceNegotiation}
                  item={item}
                  key={item.cartItemId}
                  onOpenItemNegotiation={openItemNegotiation}
                  shippingInsuranceEnabled={shippingInsuranceEnabled}
                  cartMerchantContextMatches={cartMerchantContextMatches}
                />
              ))}

              {/* In-feed Ad */}
              <AdUnit placementKey="PRODUCT_GRID_IN_FEED" />
            </div>

            {/* Right Column: Summary */}
            <div className="lg:col-span-4 mt-6 lg:mt-0">
              <div className="bg-store-background rounded-2xl shadow-sm border border-store-border p-6 sticky top-24">
                <h2 className="text-lg font-bold text-store-background-text mb-4">
                  Order Summary
                </h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-store-background-text/70 text-sm">
                    <span>Subtotal</span>
                    <span>₦{cartTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-store-background-text/70 text-sm">
                    <span>Shipping</span>
                    <span className="text-green-600 font-medium">Free</span>
                  </div>
                  <div className="border-t border-dashed border-store-border my-2" />
                  <div className="flex justify-between text-store-background-text font-bold text-lg">
                    <span>Total</span>
                    <span>₦{cartTotal.toLocaleString()}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {!hasNonNegotiableCartItem && (
                    <button
                      type="button"
                      onClick={openTotalNegotiation}
                      className="w-full bg-store-background-text/10 md:hover:bg-store-background-text/15 text-store-background-text font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-store-border active:scale-[0.98] active:bg-store-background-text/15"
                    >
                      <Calculator size={18} className="text-store-primary" />
                      Negotiate Total
                    </button>
                  )}

                  <button
                    type="button"
                    className="w-full bg-store-primary md:hover:bg-store-primary/90 text-store-primary-text font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg group active:scale-[0.98] active:shadow-none"
                  >
                    Proceed to Checkout
                    <ArrowRight
                      size={20}
                      className="md:group-hover:translate-x-1 transition-transform"
                    />
                  </button>
                </div>

                <div className="mt-6 flex justify-center">
                  <div className="flex items-center gap-2 text-xs text-store-background-text/40">
                    <ShieldCheck size={14} />
                    <span>Secure Checkout</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Negotiation Modal — only render when merchant context is available */}
      {negotiationState && merchantContext?.merchant?.id && (
        <NegotiationModal
          isOpen={negotiationState.isOpen}
          onClose={() => setNegotiationState(null)}
          productName={negotiationState.name}
          currentPrice={negotiationState.currentPrice}
          vatRate={negotiationVatRate}
          onSuccess={handleNegotiationSuccess}
          type={negotiationState.type}
          merchantId={merchantContext.merchant.id}
          cart={cart}
          {...(negotiationState.type === 'single' && negotiationState.item
            ? deriveCartLineNegotiationProps(negotiationState.item)
            : {})}
        />
      )}
    </div>
  );
};
