'use client';

import { Check, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import {
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';
import type { PaymentMethod, PaymentTab } from '../types';
import { PaymentOptionsPanel } from './PaymentOptionsPanel';
import type {
  RedvaultPaymentStatus,
  RedvaultQuoteSummary,
} from './redvault/RedvaultPaymentOption';
import {
  type FeatureSettings,
  hasAnyInstallmentOption,
  isKlumpEligible,
  isNgnChargeCurrency,
  isPaymentMethodAvailable,
} from './payment-step-availability';

type StepName = 'contact' | 'delivery' | 'payment';

interface CompletedSteps {
  contact: boolean;
  delivery: boolean;
}

interface PaymentStepProps {
  currentStep: StepName;
  completedSteps: CompletedSteps;
  paymentTab: PaymentTab;
  setPaymentTab: (v: PaymentTab) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (v: PaymentMethod) => void;
  isProcessing: boolean;
  isPayForMeValid: boolean;
  isDeliveryValid: boolean;
  payForMeDetails: { name: string; contact: string; note: string };
  setPayForMeDetails: (v: { name: string; contact: string; note: string }) => void;
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
}

export function PaymentStep({
  currentStep,
  completedSteps,
  paymentTab,
  setPaymentTab,
  paymentMethod,
  setPaymentMethod,
  isProcessing,
  isPayForMeValid,
  isDeliveryValid,
  payForMeDetails,
  setPayForMeDetails,
  dva,
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
  const redvaultHasEligibleItems =
    redvaultSummary?.eligibleSubtotalKobo !== 0;
  const hasAvailableSelectedPaymentMethod = isPaymentMethodAvailable({
    paymentMethod,
    paystackCheckoutAvailable,
    korapayCheckoutAvailable,
    bankTransferCheckoutAvailable,
    redvaultAvailable:
      redvaultCheckoutAvailable && redvaultHasEligibleItems,
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

  useEffect(() => {
    if (paymentMethod && !hasAvailableSelectedPaymentMethod) {
      setPaymentMethod('');
    }
  }, [
    hasAvailableSelectedPaymentMethod,
    paymentMethod,
    setPaymentMethod,
  ]);

  return (
    <div className={`bg-white rounded-2xl shadow-sm border ${currentStep === 'payment' ? 'border-store-primary ring-1 ring-store-primary/20' : 'border-gray-100'} overflow-hidden transition-all duration-300`}>
      <button
        type="button"
        onClick={() => completedSteps.delivery && setCurrentStep('payment')}
        disabled={!completedSteps.delivery}
        className="w-full px-6 py-4 flex items-center justify-between gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed hidden-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-inset"
      >
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors ${hasAvailableSelectedPaymentMethod ? 'bg-green-100 text-green-600' : currentStep === 'payment' ? 'bg-store-primary/10 text-store-primary' : 'bg-gray-100 text-gray-500'
            }`}>
            {hasAvailableSelectedPaymentMethod ? <Check size={14} /> : '3'}
          </div>
          Payment Method
        </h2>
        {hasAvailableSelectedPaymentMethod && currentStep !== 'payment' && (
          <span className="text-sm font-semibold text-store-primary underline-offset-4 hover:underline shrink-0">Edit</span>
        )}
      </button>

      <div className={`grid transition-all duration-300 ease-in-out ${currentStep === 'payment' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="p-6 pt-0 space-y-4">
            <PaymentOptionsPanel
              paymentTab={paymentTab}
              setPaymentTab={setPaymentTab}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
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
          </div>


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
            <button type="button"
              onClick={handlePlaceOrder}
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
                'Generate Invoice'
              ) : paymentMethod === 'payforme' ? (
                'Send Payment Link'
              ) : (
                'Place Order'
              )}
              {!isProcessing && <ChevronRight size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
