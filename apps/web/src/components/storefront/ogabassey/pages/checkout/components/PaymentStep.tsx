'use client';

import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';

import { ChevronRight, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import {
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import type { PaymentMethod, PaymentTab } from '../types';
import { CheckoutStepSection } from './CheckoutStepSection';
import { PaymentOptionsPanel } from './PaymentOptionsPanel';
import {
  type FeatureSettings,
  hasAnyInstallmentOption,
  isKlumpEligible,
  isNgnChargeCurrency,
  isPaymentMethodAvailable,
} from './payment-step-availability';
import type {
  RedvaultPaymentStatus,
  RedvaultQuoteSummary,
} from './redvault/RedvaultPaymentOption';

type StepName = 'contact' | 'delivery' | 'payment';

interface CompletedSteps {
  contact: boolean;
  delivery: boolean;
}

interface PaymentStepProps {
  currentStep: StepName;
  focusOnActivate?: boolean;
  completedSteps: CompletedSteps;
  paymentTab: PaymentTab;
  setPaymentTab: (v: PaymentTab) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (v: PaymentMethod) => void;
  isProcessing: boolean;
  isPayForMeValid: boolean;
  isDeliveryValid: boolean;
  payForMeDetails: { name: string; contact: string; note: string };
  setPayForMeDetails: (v: {
    name: string;
    contact: string;
    note: string;
  }) => void;
  dva: { isInitializingDva: boolean };
  newsletterOptIn: boolean;
  setNewsletterOptIn: (v: boolean) => void;
  handlePlaceOrder: () => void;
  setCurrentStep: (step: StepName) => void;
  merchant:
    | {
        paystack_subaccount_code?: string | null;
        paystack_subaccount_configured?: boolean | null;
        feature_settings?: FeatureSettings | null;
      }
    | null
    | undefined;
  user: { id: string } | null | undefined;
  remainingAmount: number;
  orderAmount: number;
  currency?: string;
  redvaultAvailable: boolean;
  redvaultStatus: RedvaultPaymentStatus;
  redvaultSummary: RedvaultQuoteSummary | null;
  redvaultOrderReady: boolean;
}

export function PaymentStep({
  currentStep,
  focusOnActivate,
  completedSteps,
  paymentTab,
  setPaymentTab,
  paymentMethod,
  setPaymentMethod,
  isProcessing,
  isPayForMeValid,
  newsletterOptIn,
  setNewsletterOptIn,
  handlePlaceOrder,
  setCurrentStep,
  merchant,
  user,
  remainingAmount,
  orderAmount,
  currency = 'NGN',
  redvaultAvailable,
  redvaultStatus,
  redvaultSummary,
  redvaultOrderReady,
}: PaymentStepProps) {
  // Paystack (and its DVA-backed bank transfer) settle NGN only — the
  // initialize API rejects them for non-NGN orders with UNSUPPORTED_CURRENCY,
  // so their country/subaccount availability alone must not surface them on a
  // non-NGN checkout.
  const ngnRailsAvailable = isNgnChargeCurrency(currency);
  const paystackCheckoutAvailable =
    ngnRailsAvailable && isPaystackCheckoutAvailable(merchant);
  const korapayCheckoutAvailable = isKorapayCheckoutAvailable(
    merchant,
    currency
  );
  const bankTransferCheckoutAvailable =
    ngnRailsAvailable && isBankTransferCheckoutAvailable(merchant);
  const redvaultCheckoutAvailable = ngnRailsAvailable && redvaultAvailable;
  const redvaultHasEligibleItems = redvaultSummary?.eligibleSubtotalKobo !== 0;
  const hasAvailableSelectedPaymentMethod = isPaymentMethodAvailable({
    paymentMethod,
    paystackCheckoutAvailable,
    korapayCheckoutAvailable,
    bankTransferCheckoutAvailable,
    redvaultAvailable: redvaultCheckoutAvailable && redvaultHasEligibleItems,
    featureSettings: merchant?.feature_settings,
    currency,
    orderAmount,
    payableAmount: remainingAmount,
  });
  const klumpEligible = isKlumpEligible({
    featureSettings: merchant?.feature_settings,
    currency,
    orderAmount,
    payableAmount: remainingAmount,
  });
  const hasInstallmentOptions = hasAnyInstallmentOption({
    featureSettings: merchant?.feature_settings,
    currency,
    orderAmount,
    payableAmount: remainingAmount,
  });

  const handlePaymentMethodChange = (method: PaymentMethod) => {
    setPaymentMethod(method);
    if (method) {
      captureClientEvent(
        CHECKOUT_FUNNEL_EVENTS.paymentMethodSelected,
        buildCheckoutFunnelProperties({
          channel: 'web',
          currency,
          paymentIntent: getCheckoutPaymentIntent(method),
          paymentMethod: method,
          source: 'web_checkout',
        })
      );
    }
  };

  useEffect(() => {
    if (paymentMethod && !hasAvailableSelectedPaymentMethod) {
      setPaymentMethod('');
    }
  }, [hasAvailableSelectedPaymentMethod, paymentMethod, setPaymentMethod]);

  return (
    <CheckoutStepSection
      id="checkout-payment"
      focusOnActivate={focusOnActivate}
      title="Payment Method"
      number={3}
      active={currentStep === 'payment'}
      completed={hasAvailableSelectedPaymentMethod}
      disabled={!completedSteps.delivery}
      onOpen={() => setCurrentStep('payment')}
    >
      <PaymentOptionsPanel
        paymentTab={paymentTab}
        setPaymentTab={setPaymentTab}
        paymentMethod={paymentMethod}
        setPaymentMethod={handlePaymentMethodChange}
        paystackCheckoutAvailable={paystackCheckoutAvailable}
        korapayCheckoutAvailable={korapayCheckoutAvailable}
        bankTransferCheckoutAvailable={bankTransferCheckoutAvailable}
        featureSettings={merchant?.feature_settings}
        klumpEligible={klumpEligible}
        hasInstallmentOptions={hasInstallmentOptions}
        currency={currency}
        redvaultAvailable={redvaultCheckoutAvailable}
        redvaultStatus={redvaultStatus}
        redvaultSummary={redvaultSummary}
      />

      {/* Mobile/Inline Place Order Button for Payment Step */}
      <div className="pt-4 lg:hidden">
        {/* Newsletter Opt-in (Mobile) */}
        {!user && (
          <label className="flex items-start gap-3 cursor-pointer group mb-4 px-1">
            <div className="relative flex items-center pt-0.5">
              <input
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
          aria-label={
            paymentMethod === 'invoice'
              ? 'Get a Proforma Invoice for mobile'
              : undefined
          }
          disabled={
            isProcessing ||
            (remainingAmount > 0 && !hasAvailableSelectedPaymentMethod) ||
            (paymentMethod === 'uba_redvault' &&
              (redvaultStatus === 'pending' || redvaultStatus === 'held')) ||
            (paymentMethod === 'payforme' && !isPayForMeValid)
          }
          className="w-full bg-store-primary hover:bg-store-primary/90 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-store-primary/20 active:scale-[0.98]"
        >
          {isProcessing ? (
            <Loader2 className="animate-spin" size={20} />
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
      </div>
    </CheckoutStepSection>
  );
}
