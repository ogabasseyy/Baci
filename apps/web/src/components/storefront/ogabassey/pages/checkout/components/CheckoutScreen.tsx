'use client';

import type { ComponentProps } from 'react';
import { DiscountCodeInput } from '@/components/storefront/checkout/discount-code-input';
import { MobileOrderSummary } from '../../../components/MobileCheckoutComponents';
import type { deriveCheckoutOrderSummaryPresentation } from '../derive-checkout-order-summary-presentation';
import type { useCheckoutFinancialSession } from '../hooks/use-checkout-financial-session';
import { CheckoutHeader } from './CheckoutHeader';
import { CheckoutPageHeading } from './CheckoutPageHeading';
import { CheckoutPaymentSessionOverlays } from './CheckoutPaymentSessionOverlays';
import {
  CheckoutStepComposition,
  type CheckoutStepCompositionSession,
} from './CheckoutStepComposition';
import { DeferredCheckoutAuthModal as CheckoutAuthModal } from './DeferredCheckoutAuthModal';
import { DesktopOrderSummary } from './DesktopOrderSummary';

export interface CheckoutScreenProps {
  page: {
    onReturnToCart: () => void;
    merchantName?: string | null;
    formatCurrency: (amount: number) => string;
  };
  auth: ComponentProps<typeof CheckoutAuthModal>;
  overlays: Omit<
    ComponentProps<typeof CheckoutPaymentSessionOverlays>,
    'merchantName' | 'formatCurrency'
  >;
  summary: {
    presentation: ReturnType<typeof deriveCheckoutOrderSummaryPresentation>;
    payment: ReturnType<typeof useCheckoutFinancialSession>['paymentSession'];
  };
  steps: CheckoutStepCompositionSession;
}

/** Renders the checkout screen from the existing form, payment, and summary sessions. */
export function CheckoutScreen({
  page,
  auth,
  overlays,
  summary,
  steps,
}: CheckoutScreenProps) {
  const { presentation, payment } = summary;

  return (
    <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 pb-20 flex flex-col">
      <CheckoutHeader onReturnToCart={page.onReturnToCart} />
      {auth.isOpen && (
        <CheckoutAuthModal
          isOpen={auth.isOpen}
          onOpenChange={auth.onOpenChange}
          onSuccess={auth.onSuccess}
        />
      )}
      <CheckoutPaymentSessionOverlays
        {...overlays}
        merchantName={page.merchantName}
        formatCurrency={page.formatCurrency}
      />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CheckoutPageHeading />
        {presentation.showMobile && (
          <MobileOrderSummary {...presentation.mobile} />
        )}
        {presentation.discount.visible && (
          <div className="mt-4">
            <DiscountCodeInput
              merchantId={presentation.discount.merchantId}
              cartTotal={presentation.discount.cartTotal}
              currencyCountryCode={presentation.discount.currencyCountryCode}
              payoutCurrency={presentation.discount.payoutCurrency}
              productIds={presentation.discount.productIds}
              appliedDiscount={payment.discount.applied}
              onApply={payment.discount.setApplied}
              onRemove={() => payment.discount.setApplied(null)}
            />
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          <CheckoutStepComposition session={steps} />
          <DesktopOrderSummary {...presentation.desktop} />
        </div>
      </div>
    </div>
  );
}
