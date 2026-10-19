import { ArrowRight, ShieldCheck } from 'lucide-react';
import type React from 'react';
import styles from './cart-page-summary-panel.module.css';
import { CartPageNegotiationIcon } from './cart-page-negotiation-icon';

interface CartPageSummaryPanelProps {
  displayCartTotal: number;
  hasNonNegotiableCartItem: boolean;
  hasPriceNegotiation: boolean;
  onCheckoutClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenTotalNegotiation: () => void;
}

export function CartPageSummaryPanel({
  displayCartTotal,
  hasNonNegotiableCartItem,
  hasPriceNegotiation,
  onCheckoutClick,
  onOpenTotalNegotiation,
}: CartPageSummaryPanelProps) {
  return (
    <div className="hidden lg:block lg:col-span-4 mt-6 lg:mt-0">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-24">
        <div className="space-y-3">
          {hasPriceNegotiation && !hasNonNegotiableCartItem && (
            <button
              type="button"
              onClick={onOpenTotalNegotiation}
              className="w-full bg-gray-100 md:hover:bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-200 active:scale-[0.98] active:bg-gray-200"
            >
              <CartPageNegotiationIcon
                size={18}
                className="text-store-primary"
              />
              Negotiate Total
            </button>
          )}

          <button
            type="button"
            onClick={onCheckoutClick}
            className={`w-full bg-black hover:bg-gray-900 text-white font-bold py-3.5 px-4 rounded-xl items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98] active:shadow-none relative z-10 ${styles.checkoutAction}`}
          >
            Proceed to Checkout
            <span className="opacity-50 mx-1">•</span>
            <span>₦{(displayCartTotal || 0).toLocaleString()}</span>
            <ArrowRight size={20} className="animate-slide-right ml-1" />
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
  );
}
