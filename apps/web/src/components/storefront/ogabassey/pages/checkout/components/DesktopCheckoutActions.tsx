'use client';

import { ChevronRight, Loader2, ShieldCheck } from 'lucide-react';
import type { DesktopOrderSummaryProps } from './DesktopOrderSummary';

type ActionProps = Pick<
  DesktopOrderSummaryProps,
  | 'hasUser'
  | 'newsletterOptIn'
  | 'setNewsletterOptIn'
  | 'handlePlaceOrder'
  | 'isProcessing'
  | 'isDeliveryValid'
  | 'remainingAmount'
  | 'paymentMethod'
  | 'redvaultOrderReady'
  | 'isPayForMeValid'
>;

export function DesktopCheckoutActions({
  hasUser,
  newsletterOptIn,
  setNewsletterOptIn,
  handlePlaceOrder,
  isProcessing,
  isDeliveryValid,
  remainingAmount,
  paymentMethod,
  redvaultOrderReady,
  isPayForMeValid,
}: ActionProps) {
  return (
    <>
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
        aria-label={isProcessing ? 'Processing order' : undefined}
        disabled={
          isProcessing ||
          !isDeliveryValid ||
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
        ) : paymentMethod === 'uba_redvault' && redvaultOrderReady ? (
          'Review and continue to UBA'
        ) : (
          'Place Order'
        )}
        {!isProcessing && <ChevronRight size={20} />}
      </button>

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-green-600 font-medium">
        <ShieldCheck size={14} /> Secure Encrypted Payment
      </div>
    </>
  );
}
