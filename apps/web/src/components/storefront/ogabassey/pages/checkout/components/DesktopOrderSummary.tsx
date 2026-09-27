'use client';

import { ChevronRight, Loader2, ShieldCheck, ShoppingBag } from 'lucide-react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { CartItem } from '@/hooks/cart';
import { getCartItemCheckoutUnitPrice, isQuizVoucherCartItem } from '@/lib/checkout/cart-entitlement-sanitizer';
import type { ResumedOrder, DeliveryMethod, PaymentMethod } from '../types';
import type { RedvaultQuoteSummary } from './redvault/RedvaultPaymentOption';

/** Item kind narrows cart and resumed-order values without shape checks. */
export type CheckoutItem =
  | ({ kind: 'cart' } & CartItem)
  | ({ kind: 'resumed' } & ResumedOrder['items'][number]);

interface DesktopOrderSummaryProps {
  displayItems: CheckoutItem[];
  formatCurrencyAuto: (amount: number) => string;
  effectiveCheckoutCartTotal: number;
  orderTotals: { total: number; taxAmount: number } | null;
  deliveryCost: number;
  deliveryMethod: DeliveryMethod;
  selectedQuoteId: string;
  giftWrappingCost: number;
  paymentMethod: PaymentMethod;
  walletCurrencySupported: boolean;
  walletLoading: boolean;
  walletBalance: number;
  hasUser: boolean;
  currencySymbol: string;
  payWithWallet: boolean;
  setPayWithWallet: (value: boolean) => void;
  walletAmountUsed: number;
  remainingAmount: number;
  checkoutPayWithWallet: boolean;
  redvaultSummary: RedvaultQuoteSummary | null;
  newsletterOptIn: boolean;
  setNewsletterOptIn: (value: boolean) => void;
  handlePlaceOrder: () => void | Promise<void>;
  isProcessing: boolean;
  isPayForMeValid: boolean;
}

export function DesktopOrderSummary({
  displayItems,
  formatCurrencyAuto,
  effectiveCheckoutCartTotal,
  orderTotals,
  deliveryCost,
  deliveryMethod,
  selectedQuoteId,
  giftWrappingCost,
  paymentMethod,
  walletCurrencySupported,
  walletLoading,
  walletBalance,
  hasUser,
  currencySymbol,
  payWithWallet,
  setPayWithWallet,
  walletAmountUsed,
  remainingAmount,
  checkoutPayWithWallet,
  redvaultSummary,
  newsletterOptIn,
  setNewsletterOptIn,
  handlePlaceOrder,
  isProcessing,
  isPayForMeValid,
}: DesktopOrderSummaryProps) {
  return (
    <div className="max-lg:hidden lg:block lg:col-span-4 lg:sticky lg:top-24 space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
            <ShoppingBag size={13} />
          </span>
          Order Summary
        </h2>

        {/* Items List (Collapsed View). Keep the full scroll region
            reserved so hydration of a multi-item persisted cart cannot
            grow the summary and shift the payment controls. */}
        <div className="mb-6 h-[200px] space-y-4 overflow-y-auto pr-1">
          {displayItems.map((item) => {
            // Legacy persisted carts can lack `cartItemId` until the
            // provider's upgrade path (storefront-cart-provider.tsx
            // `!item.cartItemId` branch) backfills it. Fall back to
            // `item.id` so React keys never collapse to `undefined`.
            const itemKey =
              item.kind === 'cart'
                ? item.cartItemId || item.id
                : item.id;
            const itemName = item.kind === 'cart' ? item.name : item.product_name;
            const itemImage =
              (item.kind === 'cart' ? item.image : item.image_url) || '/placeholder.png';
            const isQuizGift =
              item.kind === 'cart' && isQuizVoucherCartItem(item);
            const itemPrice =
              item.kind === 'cart'
                ? getCartItemCheckoutUnitPrice(item)
                : item.price;
            return (
              <div key={itemKey} className="flex gap-3">
                <div className="ogabassey-product-card-image-surface relative size-12 bg-gray-50 rounded-lg border border-gray-100 p-1 shrink-0">
                  <CdnFormatImage
                    src={itemImage}
                    alt={itemName}
                    fill
                    sizes="48px"
                    className="object-contain mix-blend-multiply"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 line-clamp-1">
                    {itemName}
                  </p>
                  <div className="flex justify-between items-center text-xs text-gray-500 mt-0.5">
                    <span>Qty: {item.quantity}</span>
                    <span>
                      {isQuizGift
                        ? 'Free gift'
                        : formatCurrencyAuto(itemPrice)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-dashed border-gray-200 my-4" />

        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-gray-600 text-sm">
            <span>Subtotal</span>
            <span>{formatCurrencyAuto(effectiveCheckoutCartTotal)}</span>
          </div>
          {orderTotals && (
            <div className="flex justify-between text-gray-600 text-sm">
              <span>VAT (7.5%)</span>
              <span>{formatCurrencyAuto(orderTotals.taxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-600 text-sm">
            <span>Delivery</span>
            <span
              className={
                deliveryCost === 0
                  ? 'text-green-600 font-bold'
                  : 'text-gray-900'
              }
            >
              {deliveryMethod === 'door' && !selectedQuoteId && deliveryCost === 0
                ? <span className="text-gray-500 font-normal italic">Calculated…</span>
                : deliveryCost === 0 ? 'Free' : formatCurrencyAuto(deliveryCost)}
            </span>
          </div>
          {giftWrappingCost > 0 && (
            <div className="flex justify-between text-gray-600 text-sm">
              <span>Gift Wrapping</span>
              <span>{formatCurrencyAuto(giftWrappingCost)}</span>
            </div>
          )}

          {/* Wallet Credit Section (2025: progressive disclosure - only show if balance > 0 or loading). NGN-ledger: hidden on non-NGN orders. */}
          {paymentMethod !== 'uba_redvault' && walletCurrencySupported && (walletLoading || walletBalance > 0) && hasUser && (
            <div className="py-2 animate-in fade-in">
              {walletLoading ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Checking wallet balance…</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-green-100 flex items-center justify-center">
                        <span className="text-green-600 text-xs font-bold">{currencySymbol}</span>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-700">Wallet Credit</span>
                        <span className="text-xs text-gray-500 ml-1">({formatCurrencyAuto(walletBalance)} available)</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPayWithWallet(!payWithWallet)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${payWithWallet ? 'bg-green-600' : 'bg-gray-300'
                        }`}
                    >
                      <span
                        className={`inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${payWithWallet ? 'translate-x-4' : 'translate-x-0'
                          }`}
                      />
                    </button>
                  </div>
                  {payWithWallet && walletAmountUsed > 0 && (
                    <div className="flex justify-between text-green-700 text-sm font-medium mt-2 pl-8">
                      <span>Applied Credit</span>
                      <span>-{formatCurrencyAuto(walletAmountUsed)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="border-t border-dashed border-gray-200 my-2" />

          {/* Total or Amount Due */}
          <div className="flex justify-between text-gray-900 font-bold text-lg">
            <span>
              {remainingAmount > 0 && checkoutPayWithWallet
                ? 'Amount Due'
                : 'Total'}
            </span>
            <span>{paymentMethod === 'uba_redvault' ? (redvaultSummary ? formatCurrencyAuto(redvaultSummary.payableKobo / 100) : 'Confirmed after order validation') : formatCurrencyAuto(remainingAmount)}</span>
          </div>
        </div>

        {/* Newsletter Opt-in (Moved to Summary Card) */}
        {!hasUser && (
          <label className="flex items-start gap-3 cursor-pointer group mb-4 px-1">
            <div className="relative flex items-center pt-0.5">
              <input
                id="newsletter-summary-opt-in"
                type="checkbox"
                checked={newsletterOptIn}
                onChange={(e) => setNewsletterOptIn(e.target.checked)}
                className="peer size-4 rounded border-gray-300 text-store-primary focus:ring-store-primary"
              />
            </div>
            <span className="text-xs text-gray-600 group-hover:text-gray-900 transition-colors">
              Email me with exclusive offers and new product drops.
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={handlePlaceOrder}
          disabled={
            isProcessing ||
            (remainingAmount > 0 && !paymentMethod) ||
            (paymentMethod === 'payforme' && !isPayForMeValid)
          }
          className="max-lg:hidden lg:flex w-full bg-store-primary hover:bg-store-primary/90 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl items-center justify-center gap-2 transition-all shadow-lg hover:shadow-store-primary/20 active:scale-[0.98]"
        >
          {isProcessing ? (
            <Loader2 className="animate-spin" />
          ) : paymentMethod === 'invoice' ? (
            'Get a Proforma Invoice'
          ) : paymentMethod === 'payforme' ? (
            'Send Payment Link'
          ) : (
            'Place Order'
          )}
          {!isProcessing && <ChevronRight size={20} />}
        </button>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-green-600 font-medium">
          <ShieldCheck size={14} /> Secure Encrypted Payment
        </div>
      </div>
    </div>
  );
}
