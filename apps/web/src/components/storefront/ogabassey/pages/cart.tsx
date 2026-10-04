'use client';
// Template preview

import {
  ArrowRight,
  Calculator,
  Check,
  HandCoins,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useState } from 'react';
import { isProductNegotiable } from '@baci/shared/lib';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { type CartItem, useCart } from '@/hooks/cart';
import { isQuizVoucherCartItem } from '@/lib/checkout/cart-entitlement-sanitizer';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { AdUnit } from '../components/AdUnit';
import {
  deriveCartLineNegotiationProps,
  NegotiationModal,
} from '../components/NegotiationModal';
import { runCartTotalNegotiation } from '../lib/cart-total-negotiation';
import { CartEmptyState } from './cart-empty-state';

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
  } = useCart();
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath ?? `/${storeSlug || 'ogabassey'}`;
  const negotiationVatRate =
    merchantContext?.merchant?.vat_registration_status === 'registered'
      ? (merchantContext.merchant.vat_rate ?? 7.5) / 100
      : 0;
  const [negotiationState, setNegotiationState] =
    useState<NegotiationState | null>(null);
  const _router = useRouter();

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
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center mb-6 shrink-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="text-red-600 fill-red-600" />
            Cart{' '}
            <span className="text-gray-400 text-lg font-medium">
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
              {cart.map((item) => {
                const productHref = getStorefrontProductHref(
                  item,
                  basePath
                );
                const priceToUse =
                  item.negotiatedPrice !== undefined
                    ? item.negotiatedPrice
                    : item.price;
                const itemTotal = priceToUse * item.quantity;
                const assuranceCost = item.hasAssurance
                  ? itemTotal * (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE)
                  : 0;

                return (
                  <div
                    key={item.cartItemId}
                    className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden transition-all md:hover:shadow-md active:scale-[0.99] md:active:scale-100 touch-manipulation"
                  >
                    {/* Top Row: Image & Basic Info */}
                    <div className="flex gap-4">
                      {/* Image */}
                      <Link
                        href={asRoute(productHref)}
                        className="ogabassey-product-card-image-surface w-20 h-20 md:w-28 md:h-28 bg-gray-50 rounded-xl border border-gray-100 p-2 shrink-0 flex items-center justify-center"
                      >
                        <CdnFormatImage
                          src={item.image || '/placeholder.png'}
                          alt={item.name}
                          width={112}
                          height={112}
                          sizes="(max-width: 768px) 80px, 112px"
                          className="w-full h-full object-contain mix-blend-multiply"
                        />
                      </Link>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pr-8">
                        <Link href={asRoute(productHref)}>
                          <h3 className="font-bold text-gray-900 text-sm md:text-base line-clamp-2 leading-tight mb-2 hover:text-red-600 transition-colors">
                            {item.name}
                          </h3>
                        </Link>

                        {/* Tags */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${item.condition?.toLowerCase() === 'new'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : 'bg-amber-50 text-amber-700 border-amber-100'
                              }`}
                          >
                            {item.condition}
                          </span>
                          {item.selectedColor && (
                            <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
                              <span
                                className="size-2 rounded-full border border-gray-300"
                                style={{
                                  backgroundColor:
                                    item.selectedColorValue ||
                                    item.selectedColor,
                                }}
                              />
                              <span className="text-[10px] text-gray-600">
                                {item.selectedColor}
                              </span>
                            </div>
                          )}
                          {item.secondaryColor && (
                            <div className="flex items-center gap-1 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">
                              <span className="text-[9px] text-blue-600 font-bold">
                                Pref 2:
                              </span>
                              <span className="text-[10px] text-gray-600">
                                {item.secondaryColor}
                              </span>
                            </div>
                          )}
                          {item.selectedStorage && (
                            <div className="bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-[10px] text-gray-600">
                              {item.selectedStorage}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Remove Button - Absolute Top Right */}
                      <button type="button"
                        onClick={() => removeFromCart(item.cartItemId)}
                        className="absolute top-4 right-4 text-red-600 md:hover:text-red-700 p-1.5 md:hover:bg-red-50 rounded-full transition-colors active:bg-red-50"
                        aria-label="Remove item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Separator */}
                    <div className="my-3 border-t border-dashed border-gray-100" />

                    {/* Middle Row: Controls & Price */}
                    <div className="flex items-center justify-between gap-3">
                      {/* Quantity */}
                      <div className="flex items-center border border-gray-200 rounded-lg h-9 md:h-10 bg-gray-50">
                        <button type="button"
                          onClick={() =>
                            updateQuantity(item.cartItemId, item.quantity - 1)
                          }
                          className="px-3 h-full hover:bg-white text-gray-500 rounded-l-lg transition-colors border-r border-gray-200 active:bg-gray-200"
                          disabled={item.quantity <= 1}
                          aria-label="Decrease quantity"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center text-xs md:text-sm font-bold text-gray-900">
                          {item.quantity}
                        </span>
                        <button type="button"
                          onClick={() =>
                            updateQuantity(item.cartItemId, item.quantity + 1)
                          }
                          className="px-3 h-full hover:bg-white text-gray-500 rounded-r-lg transition-colors border-l border-gray-200 active:bg-gray-200"
                          aria-label="Increase quantity"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      {/* Price */}
                      <div className="text-right">
                        {item.negotiatedPrice ? (
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] text-gray-400 line-through decoration-red-400">
                              ₦{(item.price * item.quantity).toLocaleString()}
                            </span>
                            <span className="font-bold text-green-600 text-base md:text-xl">
                              ₦{itemTotal.toLocaleString()}
                            </span>
                          </div>
                        ) : (
                          <div className="font-bold text-gray-900 text-base md:text-xl">
                            ₦{itemTotal.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Actions */}
                    <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-3 justify-between items-center">
                      {/* Assurance Toggle */}
                      <label className="flex items-start gap-2 cursor-pointer select-none group active:opacity-70 max-w-[70%]">
                        <div className="relative flex items-center mt-0.5">
                          <input
                            type="checkbox"
                            checked={item.hasAssurance || false}
                            onChange={() => toggleAssurance?.(item.cartItemId)}
                            className="peer sr-only"
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                            <ShieldCheck size={12} className="text-red-600" />
                            Ogabassey Assurance
                          </span>
                          <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                            {item.hasAssurance ? (
                              <>
                                Covers{' '}
                                <span className="font-bold text-gray-700">
                                  Screen & Liquid Damage
                                </span>
                                <span className="ml-1 text-red-600 font-bold">
                                  +₦{assuranceCost.toLocaleString()}
                                </span>
                              </>
                            ) : (
                              'Device Protection (+5%)'
                            )}
                          </p>
                          <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                            {item.hasAssurance ? 'Optional. Included in total; uncheck to remove.' : 'Optional. Check to add.'}
                          </p>
                        </div>
                      </label>

                      {/* Negotiate Button */}
                      <div className="flex items-center gap-2">
                        {item.negotiationStatus === 'accepted' ? (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-lg border border-green-100">
                            <Check size={12} strokeWidth={3} />
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
                            className="flex items-center gap-1.5 text-xs font-bold text-red-600 md:hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors border border-red-100 md:hover:border-red-200 active:bg-red-50 active:scale-95"
                          >
                            <HandCoins size={14} />
                            <span>Negotiate</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
                            <Check size={12} strokeWidth={3} />
                            <span>Best price</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* In-feed Ad */}
              <AdUnit placementKey="PRODUCT_GRID_IN_FEED" />
            </div>

            {/* Right Column: Summary */}
            <div className="lg:col-span-4 mt-6 lg:mt-0">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-24">
                <h2 className="text-lg font-bold text-gray-900 mb-4">
                  Order Summary
                </h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>Subtotal</span>
                    <span>₦{cartTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>Shipping</span>
                    <span className="text-green-600 font-medium">Free</span>
                  </div>
                  <div className="border-t border-dashed border-gray-200 my-2" />
                  <div className="flex justify-between text-gray-900 font-bold text-lg">
                    <span>Total</span>
                    <span>₦{cartTotal.toLocaleString()}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {!hasNonNegotiableCartItem && (
                    <button type="button"
                      onClick={openTotalNegotiation}
                      className="w-full bg-gray-100 md:hover:bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-200 active:scale-[0.98] active:bg-gray-200"
                    >
                      <Calculator size={18} className="text-red-600" />
                      Negotiate Total
                    </button>
                  )}

                  <button type="button" className="w-full bg-red-600 md:hover:bg-red-700 text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg md:hover:shadow-red-200 group active:scale-[0.98] active:shadow-none">
                    Proceed to Checkout
                    <ArrowRight
                      size={20}
                      className="md:group-hover:translate-x-1 transition-transform"
                    />
                  </button>
                </div>

                <div className="mt-6 flex justify-center">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
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
