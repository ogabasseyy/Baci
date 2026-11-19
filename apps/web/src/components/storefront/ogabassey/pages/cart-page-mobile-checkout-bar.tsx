import { ArrowRight } from 'lucide-react';
import type React from 'react';
import styles from './cart-page-mobile-checkout-bar.module.css';
import { CartPageNegotiationIcon } from './cart-page-negotiation-icon';

interface CartPageMobileCheckoutBarProps {
  displayCartTotal: number;
  hasNonNegotiableCartItem: boolean;
  hasPriceNegotiation: boolean;
  onCheckoutClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenTotalNegotiation: () => void;
}

export function CartPageMobileCheckoutBar({
  displayCartTotal,
  hasNonNegotiableCartItem,
  hasPriceNegotiation,
  onCheckoutClick,
  onOpenTotalNegotiation,
}: CartPageMobileCheckoutBarProps) {
  return (
    <div className={`fixed bottom-24 left-0 right-0 bg-white border-t border-gray-200 p-3 items-center gap-2 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] z-40 ${styles.checkoutBar}`}>
      {hasPriceNegotiation && !hasNonNegotiableCartItem && (
        <button
          type="button"
          onClick={onOpenTotalNegotiation}
          className="h-14 px-3 flex flex-col items-center justify-center bg-gray-100 hover:bg-gray-200 active:bg-gray-200 rounded-xl border border-gray-200 transition-colors shrink-0"
          aria-label="Bulk Negotiate"
          title="Bulk Negotiate"
        >
          <CartPageNegotiationIcon size={24} className="text-store-primary" />
          <span className="text-[10px] font-bold text-gray-600 mt-0.5">
            Negotiate
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onCheckoutClick}
        className={`flex-1 active:scale-[0.98] font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg ${styles.checkoutAction}`}
      >
        <span>Checkout</span>
        <span className="opacity-50 mx-1">•</span>
        <span>₦{(displayCartTotal || 0).toLocaleString()}</span>
        <ArrowRight size={18} className="animate-slide-right ml-1" />
      </button>
    </div>
  );
}
