'use client';

import { Loader2, ShoppingBag } from 'lucide-react';
import type { DeliveryMethod, PaymentMethod } from '../types';
import { DesktopCheckoutActions } from './DesktopCheckoutActions';
import { type CheckoutItem, DesktopOrderSummaryLine } from './DesktopOrderSummaryLine';
import type { RedvaultQuoteSummary } from './redvault/RedvaultPaymentOption';

export type { CheckoutItem } from './DesktopOrderSummaryLine';

export interface DesktopOrderSummaryProps {
  displayItems: CheckoutItem[];
  formatCurrencyAuto: (amount: number) => string;
  summarySubtotal: number;
  orderTotals: { total: number; taxAmount: number } | null;
  taxLabel: string;
  deliveryCost: number;
  discountAmount: number;
  deliveryMethod: DeliveryMethod | null;
  selectedQuoteId: string;
  giftWrappingCost: number;
  paymentMethod: PaymentMethod;
  walletCurrencySupported: boolean;
  walletRedemptionAllowed: boolean;
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
  redvaultOrderReady: boolean;
  newsletterOptIn: boolean;
  setNewsletterOptIn: (value: boolean) => void;
  handlePlaceOrder: () => void | Promise<void>;
  isProcessing: boolean;
  isPayForMeValid: boolean;
  isDeliveryValid: boolean;
}

export function DesktopOrderSummary({
  displayItems,
  formatCurrencyAuto,
  summarySubtotal,
  orderTotals,
  taxLabel,
  deliveryCost,
  discountAmount,
  deliveryMethod,
  selectedQuoteId,
  giftWrappingCost,
  paymentMethod,
  walletCurrencySupported,
  walletRedemptionAllowed,
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
  redvaultOrderReady,
  newsletterOptIn,
  setNewsletterOptIn,
  handlePlaceOrder,
  isProcessing,
  isPayForMeValid,
  isDeliveryValid,
}: DesktopOrderSummaryProps) {
  return (
    <div className="max-lg:hidden lg:block lg:col-span-4 lg:sticky lg:top-24 space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-store-primary/10 text-store-primary"
          >
            <ShoppingBag size={13} />
          </span>
          Order Summary
        </h2>

        {/* Items List (Collapsed View). Keep the full scroll region
            reserved so hydration of a multi-item persisted cart cannot
            grow the summary and shift the payment controls. */}
        <div className="mb-6 h-[200px] space-y-4 overflow-y-auto pr-1">
          {displayItems.map((item, index) => (
            <DesktopOrderSummaryLine
              key={
                item.kind === 'cart'
                  ? item.cartItemId || `${item.id}-${index}`
                  : `${item.id}-${index}`
              }
              item={item}
              formatCurrencyAuto={formatCurrencyAuto}
            />
          ))}
        </div>

        <div className="border-t border-dashed border-gray-200 my-4" />

        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-gray-600 text-sm">
            <span>Subtotal</span>
            <span>{formatCurrencyAuto(summarySubtotal)}</span>
          </div>
          {orderTotals && (
            <div className="flex justify-between text-gray-600 text-sm">
              <span>{taxLabel}</span>
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
              {deliveryMethod === 'door' &&
              !selectedQuoteId &&
              deliveryCost === 0 ? (
                <span className="text-gray-500 font-normal italic">
                  Calculated…
                </span>
              ) : deliveryCost === 0 ? (
                'Free'
              ) : (
                formatCurrencyAuto(deliveryCost)
              )}
            </span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-store-primary text-sm">
              <span>Discount</span>
              <span>-{formatCurrencyAuto(discountAmount)}</span>
            </div>
          )}
          {giftWrappingCost > 0 && (
            <div className="flex justify-between text-gray-600 text-sm">
              <span>Gift Wrapping</span>
              <span>{formatCurrencyAuto(giftWrappingCost)}</span>
            </div>
          )}

          {/* Wallet Credit Section (2025: progressive disclosure - only show if balance > 0 or loading). NGN-ledger: hidden on non-NGN orders. */}
          {walletRedemptionAllowed &&
            paymentMethod !== 'uba_redvault' &&
            walletCurrencySupported &&
            (walletLoading || walletBalance > 0) &&
            hasUser && (
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
                          <span className="text-green-600 text-xs font-bold">
                            {currencySymbol}
                          </span>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-700">
                            Wallet Credit
                          </span>
                          <span className="text-xs text-gray-500 ml-1">
                            ({formatCurrencyAuto(walletBalance)} available)
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPayWithWallet(!payWithWallet)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                          payWithWallet ? 'bg-green-600' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            payWithWallet ? 'translate-x-4' : 'translate-x-0'
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
            <span>
              {paymentMethod === 'uba_redvault'
                ? redvaultSummary
                  ? formatCurrencyAuto(redvaultSummary.payableKobo / 100)
                  : 'Confirmed after order validation'
                : formatCurrencyAuto(remainingAmount)}
            </span>
          </div>
        </div>

        <DesktopCheckoutActions
          hasUser={hasUser}
          newsletterOptIn={newsletterOptIn}
          setNewsletterOptIn={setNewsletterOptIn}
          handlePlaceOrder={handlePlaceOrder}
          isProcessing={isProcessing}
          isDeliveryValid={isDeliveryValid}
          remainingAmount={remainingAmount}
          paymentMethod={paymentMethod}
          redvaultOrderReady={redvaultOrderReady}
          isPayForMeValid={isPayForMeValid}
        />
      </div>
    </div>
  );
}
