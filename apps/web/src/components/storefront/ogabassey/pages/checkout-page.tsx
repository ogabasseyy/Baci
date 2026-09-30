'use client';
import { useCheckoutAddressInference } from './checkout/hooks/use-checkout-address-inference';
import { useCheckoutResumeLifecycle } from './checkout/hooks/use-checkout-resume-lifecycle';
import { resolveCheckoutResumeContext } from './checkout/resolve-checkout-resume-context';

import { useCheckoutDeliverySession } from './checkout/hooks/use-checkout-delivery-session';
import { useCheckoutCustomerPrefill } from './checkout/hooks/use-checkout-customer-prefill';
import {
  useDvaConfirmTransfer,
  type DvaModalData,
} from './checkout/hooks/use-dva-confirm-transfer';

import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { CheckoutPaymentOverlays } from './checkout/components/CheckoutPaymentOverlays';
import {
  CheckoutHeader,
  CheckoutPageHeading,
} from './checkout/components/CheckoutHeader';
import { CheckoutStepComposition } from './checkout/components/CheckoutStepComposition';
import {
  DiscountCodeInput,
} from '@/components/storefront/checkout/discount-code-input';
import { MobileOrderSummary } from '../components/MobileCheckoutComponents';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { useCheckoutFormState } from './checkout/hooks/use-checkout-form-state';
import { useCheckoutStepState } from './checkout/hooks/use-checkout-step-state';
import { useCheckoutCryptoSession } from './checkout/hooks/use-checkout-crypto-session';
import { usePaymentReturnReset } from './checkout/use-payment-return-reset';
import { useEffect, useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useCurrency } from '@/hooks/use-currency';
import type {
  DvaData,
  PendingCryptoOrder,
} from './checkout/types';
import {
  usePersistedState,
} from '@/hooks/use-persisted-state';
import { useAuthSafe } from '@/contexts/auth-context';
import { DeferredCheckoutAuthModal as CheckoutAuthModal } from './checkout/components/DeferredCheckoutAuthModal';
import {
  type PlaceDetails,
} from '@/components/address-autocomplete';
import { asRoute } from '@/lib/routes';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { toast } from '@/hooks/use-toast';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import {
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';
import { isNgnChargeCurrency } from './checkout/components/payment-step-availability';
import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from './checkout/pending-checkout-order';
import { useCheckoutSubmissionState } from './checkout/hooks/use-checkout-submission-state';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { useRedvaultPaymentAvailability } from './checkout/hooks/use-redvault-payment-availability';
import {
  inferAddressLocationFromInput,
} from './checkout/utils';
import { useCheckoutOrderSubmission } from './checkout/hooks/use-checkout-order-submission';
import { useWalletFundedBankTransfer } from './checkout/hooks/use-wallet-funded-bank-transfer';
import { useWalletFundedOrderCompletion } from './checkout/hooks/use-wallet-funded-order-completion';
import { useStorefrontCustomerSession } from './checkout/hooks/use-storefront-customer-session';
import {
  useResumedCheckoutStartFunnel,
} from './checkout/hooks/use-resumed-checkout-start-funnel';
import { deriveCheckoutDisplayModel } from './checkout/derive-checkout-display-model';
import { deriveCheckoutCartModel } from './checkout/derive-checkout-cart-model';
import { useCheckoutFinancialSession } from './checkout/hooks/use-checkout-financial-session';
import { readCheckoutAttemptGeneration } from './checkout/checkout-attempt-generation';
import { CheckoutResumeStatus } from './checkout/components/CheckoutResumeStatus';
import {
  DesktopOrderSummary,
} from './checkout/components/DesktopOrderSummary';


/**
 * Module-scope checkout helpers.
 *
 * React Compiler cannot yet lower `try {} finally {}` blocks or `throw`
 * statements nested inside a `try/catch` within a component body — each one
 * bails the entire component out of automatic memoization. The async
 * fetch/payment flows below are hoisted to module scope (taking state setters
 * as explicit parameters) so `CheckoutPage` stays compilable while runtime
 * behavior is unchanged.
 */

/**
 * Throws at module scope so call sites inside the component's try/catch avoid
 * the compiler's "ThrowStatement inside of try/catch" bailout.
 */
function raiseCheckoutError(message: string): never {
  throw new Error(message);
}



// Module-scope helper: probes DVA settlement server-side so "Confirm
// Transfer Sent" only records a conversion for a detected transfer.
// Prefers the token-scoped order status: the settlement webhook marks the
// ORDER paid after matching the transfer to the dedicated account, while
// the DVA reference is a locally generated BAC-* value that was never
// registered as a Paystack transaction (probing /transaction/verify with it
// can only error for real DVA transfers).
export const CheckoutPage: React.FC = () => {
  const { cart, clearCart, isHydrated, removeFromCart } = useCart();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const redvaultAvailability = useRedvaultPaymentAvailability(merchant?.id);

  // Address-form country: the merchant's own market (ISO-2, upper-case), NG as
  // the pilot default when unset. Drives the state list source, the Places
  // country bias, and whether the NG-only state->city sub-fetch runs — so a
  // non-NG merchant's shoppers can populate state/city and reach merchant rates.
  const merchantCountry = (merchant?.country?.trim() || 'NG').toUpperCase();

  // Merchant-resolved currency (payout_currency first, country second, NGN
  // fallback). `currencyCode` is sent to /api/payments/initialize instead of a
  // hardcoded 'NGN'; the compact formatter renders order amounts.
  const { formatCurrencyAuto, currencySymbol, currencyCode } = useCurrency();

  const hasPriceNegotiation = hasStorefrontPriceNegotiation(merchant);
  const {
    checkoutCart,
    checkoutCartCatalogSubtotal,
    checkoutCartTotal,
    itemSubtotal,
    quoteItemsFingerprint,
  } = deriveCheckoutCartModel(cart, hasPriceNegotiation);

  // Paystack (and its DVA-backed bank transfer) settle NGN only — mirror the
  // PaymentStep gating so a non-NGN checkout never renders rails the
  // initialize API would reject with UNSUPPORTED_CURRENCY.
  const ngnRailsAvailable = isNgnChargeCurrency(currencyCode);
  const paystackCheckoutAvailable =
    ngnRailsAvailable && isPaystackCheckoutAvailable(merchant);
  const korapayCheckoutAvailable = isKorapayCheckoutAvailable(
    merchant,
    currencyCode
  );
  const bankTransferCheckoutAvailable =
    ngnRailsAvailable && isBankTransferCheckoutAvailable(merchant);
  const basePath = merchantContext?.basePath;
  const router = useRouter();

  const getHref = (path: string) =>
    path.startsWith('http') ? path : `${basePath || ''}${path === '/' ? '' : path}`;

  const searchParams = useSearchParams();
  const auth = useAuthSafe();
  const user = auth?.user;

  // Persisted checkout form state - survives hydration re-mounts and page refreshes
  // Using custom hook with debounced sessionStorage persistence (2025 best practice)
  const {
    values: checkoutForm,
    setValue: setCheckoutField,
    setValues: setCheckoutFields,
    clear: clearCheckoutSession,
  } = useCheckoutFormState();

  // Destructure for convenience (these are reactive)
  const {
    firstName,
    lastName,
    customerEmail,
    customerPhone,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    deliveryCoordinates,
    deliveryMethod,
    airportType,
    airportRequiresQuote,
    selectedQuoteId: persistedSelectedQuoteId,
    selectedProviderRateId: persistedSelectedProviderRateId,
    newsletterOptIn,
    currentStep: rawCurrentStep,
    completedSteps: rawCompletedSteps,
  } = checkoutForm;

  const {
    currentStep,
    completedSteps,
    focusActiveStep,
    setCurrentStep,
    setCompletedSteps,
    completeContact,
  } = useCheckoutStepState({
    isHydrated,
    currentStep: rawCurrentStep,
    completedSteps: rawCompletedSteps,
    setField: setCheckoutField,
    setFields: setCheckoutFields,
  });

  // Convenient setters that update the persisted form
  const setFirstName = (v: string) => setCheckoutField('firstName', v);
  const setLastName = (v: string) => setCheckoutField('lastName', v);
  const setCustomerEmail = (v: string) => setCheckoutField('customerEmail', v);
  const setCustomerPhone = (v: string) => setCheckoutField('customerPhone', v);
  const inferredLocation = useCheckoutAddressInference(setCheckoutFields);
  const [
    pendingCheckoutOrder,
    setPendingCheckoutOrder,
    clearPendingCheckoutOrder,
  ] = usePersistedState<PendingCheckoutOrderSnapshot | null>(
    CHECKOUT_PENDING_ORDER_STORAGE_KEY,
    null
  );

  // Non-persisted UI state
  const [createAccount, setCreateAccount] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const setNewsletterOptIn = (value: boolean) => setCheckoutField('newsletterOptIn', value);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Dedicated Virtual Account (DVA) state
  const [dvaData, setDvaData] = useState<DvaModalData | null>(null);
  const [isInitializingDva, setIsInitializingDva] = useState(false);
  const [dvaCountdown, setDvaCountdown] = useState(3600); // 1 hour in seconds
  // "Confirm Transfer Sent" lifecycle (server verification, conversion,
  // routing, delayed cart clear) tied to the modal attempt that started
  // it — see useDvaConfirmTransfer.
  const { closeDvaModal, handleDvaConfirmTransfer, isVerifyingDva } =
    useDvaConfirmTransfer({
      checkoutCart,
      clearCart,
      clearCheckoutSession,
      clearPendingCheckoutOrder,
      currencyCode,
      dvaData,
      getHref,
      merchantSlug: merchant?.slug ?? undefined,
      setDvaData,
    });

  // Mobile app order resume state
  // When opening from mobile app with ?orderId=xxx&gateway=credpal, we resume that order
  const {
    resumeOrderId,
    resumeTrackingToken,
    resumeLookupEmail,
    resumeMerchantSlug,
    preferredGateway,
  } = resolveCheckoutResumeContext({
    searchParams,
    pendingCheckoutOrder,
    merchantId: merchant?.id,
    merchantSlug: merchant?.slug,
  });
  const {
    isProcessing,
    setIsProcessing,
    isOrderInFlightRef,
    tryBeginSubmission,
    releaseSubmission,
    handleSubmissionError,
  } = useCheckoutSubmissionState({ setCurrentStep, setCompletedSteps });
  const crypto = useCheckoutCryptoSession({
    merchantId: merchant?.id,
    clearCheckoutSession,
    clearPendingCheckoutOrder,
    clearCart,
    getHref,
    isOrderInFlightRef,
  });
  const {
    cryptoPaymentData,
    setCryptoPaymentData,
    isVerifyingCrypto,
    cryptoVerificationStatus,
    isInitializingCrypto,
    initializeCryptoPayment,
    verifyCryptoPayment,
    dismissCryptoModal,
    pendingCryptoOrder,
    setPendingCryptoOrder,
    showCryptoSelector,
    setShowCryptoSelector,
    selectedCryptoChain,
    selectedCryptoCurrency,
  } = crypto;
  const { resumedOrder, isLoadingResumedOrder, resumeOrderError } =
    useCheckoutResumeLifecycle({
      resumeOrderId,
      resumeTrackingToken,
      resumeLookupEmail,
      resumeMerchantSlug,
      preferredGateway,
      isHydrated,
      hasCheckoutCartItems: checkoutCart.length > 0,
      setCheckoutFields,
      merchantSlug: merchant?.slug,
      merchantChargeCurrency: currencyCode,
      isProcessing,
      setIsProcessing,
      clearCheckoutSession,
      routerPush: (url: string) => router.push(asRoute(url)),
      getHref,
    });

  const {
    displayItems,
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal,
    summarySubtotal,
    hasCheckoutCartItems,
    mobileSummaryCart,
    summaryOrder,
  } = deriveCheckoutDisplayModel({
    checkoutCart,
    checkoutCartTotal,
    currencyCode,
    itemSubtotal,
    resumedOrder,
  });

  // Set once an order is created for this attempt: post-creation rerenders
  // (pending-order persist, widget state) must not re-emit checkout_started
  // for the same attempt just because the generation already rotated.
  // Declared before the funnel hook below, which reads it.
  const [checkoutOrderCreated, setCheckoutOrderCreated] = useState(false);
  // Session-persisted checkout attempt: rotates after every created order so
  // a repeat purchase of the same cart emits a fresh start, while a reload
  // mid-attempt keeps the same generation (unlike React useId, which is
  // deterministic per rendered tree and collides after reload).
  // Start instrumentation (including the resumed-order stamped
  // total/currency derivation) lives in the focused hook below so edits
  // here leave this page smaller, not larger.
  useResumedCheckoutStartFunnel({
    attemptId: `gen-${readCheckoutAttemptGeneration()}`,
    checkoutCartTotal,
    currencyCode,
    displayItems,
    effectiveItemSubtotal,
    hasCheckoutCartItems,
    isHydrated: isHydrated && !checkoutOrderCreated,
    merchantId: merchant?.id,
    resumedOrder,
  });

  usePaymentReturnReset(releaseSubmission);

  // Storefront customer sign-in state. The `(commerce)` checkout route mounts
  // neither `AuthProvider` nor `CustomerAuthProvider`, so `useAuthSafe()` above
  // is null here even for a signed-in customer. The wallet-funded gate must read
  // the cookie session directly (same source as the storefront header) or the
  // dark-launch flow would never activate for real customers.
  const { waitForResolvedAuthenticated: waitForResolvedStorefrontCustomerAuth } =
    useStorefrontCustomerSession(merchant?.slug ?? undefined);

  // Prefer the persisted fee on resume (deep-link URLs omit giftWrappingCost).
  const giftWrappingCost =
    resumedOrder?.gift_wrapping_fee ??
    (Number(searchParams.get('giftWrappingCost')) || 0);

  const delivery = useCheckoutDeliverySession({
    airportRequiresQuote,
    airportType,
    completedSteps,
    inferredLocation,
    isHydrated,
    merchantId: merchant?.id,
    merchantCountry,
    merchantSlug: merchant?.slug,
    checkoutCart,
    checkoutCartCatalogSubtotal,
    quoteItemsFingerprint,
    deliveryCoordinates,
    persistedSelectedQuoteId,
    persistedSelectedProviderRateId,
    currentStep,
    setCurrentStep,
    setCheckoutField,
    setCheckoutFields,
    deliveryMethod,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    customerPhone,
    firstName,
    lastName,
    customerEmail,
  });
  const {
    address: deliveryAddress,
    method: deliverySelection,
    quotes: deliveryQuotes,
    options: deliveryOptions,
    validation: { isValid: isDeliveryValid },
    cost: deliveryCost,
  } = delivery;
  const { addresses, selectedId: selectedAddressId, isNewMode: isNewAddressMode } = deliveryAddress;
  const {
    items: shippingQuotes,
    selectedId: selectedQuoteId,
    matchesSelectedMethod: selectedQuoteMatchesDeliveryMethod,
  } = deliveryQuotes;
  const { isNewDeliveryAddressReady } = deliveryAddress;
  const deliveryAddressHandlers = deliveryAddress.handlers;

  // Note: newAddressState, newAddressCity, newAddressStreet are now part of checkoutForm (persisted)


  // Live and resumed amount arithmetic feeds the payment session and summary.
  const { orderTotals, paymentSession, summaryAmounts } =
    useCheckoutFinancialSession({
      merchant,
      effectiveItemSubtotal,
      effectiveCheckoutCartTotal,
      deliveryCost,
      deliveryMethod,
      giftWrappingCost,
      hasCheckoutCartItems,
      resumedOrder: summaryOrder,
      clearPendingCheckoutOrder,
      currencyCode,
      discountSubtotal: effectiveCheckoutCartTotal,
      hasAuthenticatedUser: Boolean(user),
      isOrderInFlightRef,
      merchantSlug: merchant?.slug ?? undefined,
      pendingCheckoutOrder,
      walletSessionUserId: user?.id,
      resumeOrderId,
      preferredGateway,
    });

  // Note: currentStep and completedSteps are now part of checkoutForm (persisted)

  useCheckoutCustomerPrefill({
    user,
    values: { customerEmail, customerPhone, firstName, lastName },
    setFields: setCheckoutFields,
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Date Calculation for Door Delivery
  const getDeliveryDateRange = () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() + 1);
    const end = new Date(today);
    end.setDate(today.getDate() + 3);

    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
    };
    return `${start.toLocaleDateString('en-GB', options)} to ${end.toLocaleDateString('en-GB', options)}`;
  };

  const paymentMethod = paymentSession.method;
  const redvaultStatus = paymentSession.redvault.status;
  const redvaultOrderReady = paymentSession.redvault.orderReady;
  const walletAmountUsed = paymentSession.wallet.amountUsed;
  const remainingAmount = paymentSession.wallet.remainingAmount;
  const total = paymentSession.total;

  const completeWalletFundedOrder = useWalletFundedOrderCompletion({
    clearCart,
    clearCheckoutSession,
    clearPendingCheckoutOrder,
    getHref,
    paymentMethod,
  });
  // Wallet-funded bank transfer (P4a, dark-launched). Signed-in customers of
  // an auto-debit-enabled merchant fund the order through their standing
  // wallet account; the webhook credits it and the order auto-debits.
  const walletFundedTransfer = useWalletFundedBankTransfer({
    merchantId: merchant?.id,
    merchantSlug: merchant?.slug ?? undefined,
    onOrderPaid: completeWalletFundedOrder,
  });

  useEffect(() => {
    if (
      pendingCheckoutOrder &&
      merchant?.id &&
      pendingCheckoutOrder.merchantId !== merchant.id
    ) {
      clearPendingCheckoutOrder();
    }
  }, [pendingCheckoutOrder, merchant?.id, clearPendingCheckoutOrder]);

  const { handlePlaceOrder } = useCheckoutOrderSubmission({
    account: {
      createAccount,
      password: accountPassword,
      user,
      waitForResolvedCustomerAuth: waitForResolvedStorefrontCustomerAuth,
    },
    cart: {
      cart,
      checkoutCart,
      checkoutCartTotal,
      clearCart,
      removeFromCart,
    },
    contact: {
      customerEmail,
      customerPhone,
      firstName,
      lastName,
      newsletterOptIn,
    },
    delivery: {
      session: delivery,
      method: deliveryMethod,
      airportType,
      airportRequiresQuote,
      newAddressStreet,
      newAddressCity,
      newAddressState,
      merchantCountry,
      giftWrappingCost,
      effectiveItemSubtotal,
      taxAmount: orderTotals?.taxAmount ?? 0,
    },
    merchant,
    navigation: {
      setCurrentStep,
      setCompletedSteps,
      pushSuccessRoute: (url) => router.push(asRoute(url)),
      getHref,
    },
    order: {
      pending: pendingCheckoutOrder,
      clearPending: clearPendingCheckoutOrder,
      setPending: setPendingCheckoutOrder,
      setOrderCreated: setCheckoutOrderCreated,
      clearCheckoutSession,
      setDvaData,
      setDvaCountdown,
      setIsInitializingDva,
      setPendingCryptoOrder,
      setShowCryptoSelector,
      setCryptoPaymentData,
      walletFundedTransfer,
    },
    payment: {
      session: paymentSession,
      bankTransferAvailable: bankTransferCheckoutAvailable,
      paystackAvailable: paystackCheckoutAvailable,
      korapayAvailable: korapayCheckoutAvailable,
      redvaultAvailable: redvaultAvailability.available,
      currencyCode,
    },
    resumed: {
      order: resumedOrder,
      preferredGateway,
      trackingToken: resumeTrackingToken,
      merchantSlugFromResume: resumeMerchantSlug,
    },
    processing: {
      setIsProcessing,
      isOrderInFlightRef,
      tryBeginSubmission,
      releaseSubmission,
      handleSubmissionError,
    },
  });

  const isPayForMeValid = paymentSession.payForMe.isValid;

  // Loading state (Initial fetch OR waiting for auto-trigger)
  // This prevents the form from flashing briefly before the payment widget opens
  const isAutoTriggerProcessing =
    isHydrated &&
    checkoutCart.length === 0 &&
    resumedOrder &&
    !!preferredGateway &&
    !isProcessing;

  if (
    (checkoutCart.length === 0 && isLoadingResumedOrder) ||
    isAutoTriggerProcessing
  ) {
    return (
      <CheckoutResumeStatus
        status={isLoadingResumedOrder ? 'loading' : 'initializing'}
      />
    );
  }

  // Error state for order resumption
  if (checkoutCart.length === 0 && resumeOrderId && resumeOrderError) {
    return (
      <CheckoutResumeStatus
        status="error"
        message={resumeOrderError}
        onRetry={() => window.location.reload()}
        onGoHome={() => router.push(asRoute(getHref('/')))}
        onContactSupport={() => router.push(asRoute(getHref('/contact')))}
      />
    );
  }

  // Empty cart check - only show after hydration confirms cart is genuinely empty
  // Skip this check when resuming an order (cart is empty during order resumption)




  return (
    <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 pb-20 flex flex-col">
      <CheckoutHeader
        onReturnToCart={() => router.push(asRoute(getHref('/cart')))}
      />
      {isAuthModalOpen && <CheckoutAuthModal
        isOpen={isAuthModalOpen}
        onOpenChange={setIsAuthModalOpen}
        onSuccess={() => setIsAuthModalOpen(false)}
      />}

      <CheckoutPaymentOverlays
        cryptoSelector={showCryptoSelector ? {
          selectedCryptoCurrency,
          selectedCryptoChain,
          supportedChains: crypto.supportedChains,
          isInitializingCrypto,
          onCurrencyChange: crypto.changeCurrency,
          onChainChange: crypto.changeChain,
          onInitialize: initializeCryptoPayment,
          onClose: crypto.closeSelector,
        } : undefined}
        cryptoPayment={cryptoPaymentData ? {
          data: cryptoPaymentData,
          verificationStatus: cryptoVerificationStatus,
          isVerifying: isVerifyingCrypto,
          onVerify: verifyCryptoPayment,
          onClose: dismissCryptoModal,
        } : undefined}
        walletTransfer={{
          consent: walletFundedTransfer.consentRequested ? {
            merchantName: merchant?.business_name || 'This store',
            onAccept: walletFundedTransfer.acceptConsent,
            onDecline: walletFundedTransfer.declineConsent,
          } : undefined,
          funding: walletFundedTransfer.account && walletFundedTransfer.intent ? {
            account: walletFundedTransfer.account,
            error: walletFundedTransfer.error,
            formatCurrency: formatCurrencyAuto,
            intent: walletFundedTransfer.intent,
            isChecking: walletFundedTransfer.isChecking,
            onCheckNow: walletFundedTransfer.checkNow,
            onClose: walletFundedTransfer.close,
          } : undefined,
        }}
        dva={dvaData ? {
          data: dvaData,
          formatCurrency: formatCurrencyAuto,
          isVerifying: isVerifyingDva,
          onClose: closeDvaModal,
          onConfirmTransfer: handleDvaConfirmTransfer,
        } : undefined}
      />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CheckoutPageHeading />

        {/* MOBILE ORDER SUMMARY (Collapsible) */}
        {/* MOBILE ORDER SUMMARY (Collapsible) */}
        {paymentMethod !== 'uba_redvault' && <MobileOrderSummary
          cart={mobileSummaryCart}
          cartTotal={summarySubtotal}
          deliveryCost={summaryAmounts.summaryDeliveryCost}
          taxAmount={summaryAmounts.summaryTaxAmount}
          discountAmount={summaryAmounts.summaryDiscountAmount}
          deliveryMethod={summaryAmounts.summaryDeliveryMethod}
          giftWrappingCost={summaryAmounts.summaryGiftWrappingCost}
          walletBalance={paymentSession.wallet.balance}
          payWithWallet={paymentSession.checkoutValues.payWithWallet}
          walletAmountUsed={walletAmountUsed}
          remainingAmount={remainingAmount}
        />}

        {/* Resumed-order-only checkout uses its persisted total and skips order
            creation, so local discounts must not change its displayed due. An
            active cart remains the pricing source when both are present. */}
        {(hasCheckoutCartItems || (!resumeOrderId && !resumedOrder)) && (
          <div className="mt-4">
            <DiscountCodeInput
              merchantId={merchant?.id || ''}
              cartTotal={effectiveCheckoutCartTotal}
              currencyCountryCode={merchant?.country ?? 'NG'}
              payoutCurrency={merchant?.payout_currency ?? null}
              productIds={checkoutCart.map((item) => item.id)}
              appliedDiscount={paymentSession.discount.applied}
              onApply={paymentSession.discount.setApplied}
              onRemove={() => paymentSession.discount.setApplied(null)}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          <CheckoutStepComposition
            flow={{
              currentStep,
              completedSteps,
              focusOnActivate: focusActiveStep,
              signedIn: Boolean(user),
            }}
            onSignIn={() => setIsAuthModalOpen(true)}
            contact={{
              values: { firstName, lastName, customerEmail, customerPhone },
              onChange: setCheckoutField,
              account: { createAccount, password: accountPassword },
              onAccountChange: ({
                createAccount: nextCreateAccount,
                password,
              }) => {
                setCreateAccount(nextCreateAccount);
                setAccountPassword(password);
              },
              onOpen: () => setCurrentStep('contact'),
              onComplete: completeContact,
            }}
            delivery={{
              addressFields: {
                signedIn: Boolean(user),
                addresses,
                isNewAddressMode,
                selectedAddressId,
                newAddressStreet,
                newAddressCity,
                newAddressState,
                merchantCountry,
                addressReady: isHydrated && isNewDeliveryAddressReady,
                onToggleAddressMode: () =>
                  deliveryAddress.setIsNewMode(!isNewAddressMode),
                onSelectAddress: deliveryAddressHandlers.onSelectAddress,
                onStreetChange: deliveryAddressHandlers.onStreetChange,
                onSelectPlace: deliveryAddressHandlers.onSelectPlace,
              },
              deliveryOptions,
              isDeliveryValid,
              onContinue: () => {
                captureClientEvent(
                  CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
                  buildCheckoutFunnelProperties({
                    channel: 'web',
                    checkoutStep: 'shipping_info',
                    source: 'web_checkout',
                  })
                );
                setCompletedSteps((prev) => ({ ...prev, delivery: true }));
                setCurrentStep('payment');
              },
              onOpen: () => setCurrentStep('delivery'),
              summary:
                deliveryMethod === 'door'
                  ? `By Road${newAddressCity ? ` · ${newAddressCity}` : ''}`
                  : deliveryMethod === 'pickup_station'
                    ? 'Pickup Station'
                    : deliveryMethod === 'pickup'
                      ? 'Store Pickup'
                      : 'By Air',
            }}
            payment={{
              paymentTab: paymentSession.tab,
              setPaymentTab: paymentSession.setTab,
              paymentMethod,
              setPaymentMethod: paymentSession.selectMethod,
              isProcessing,
              isPayForMeValid,
              isDeliveryValid,
              payForMeDetails: paymentSession.payForMe.details,
              setPayForMeDetails: paymentSession.payForMe.setDetails,
              dva: { isInitializingDva },
              newsletterOptIn,
              setNewsletterOptIn,
              handlePlaceOrder,
              setCurrentStep,
              merchant,
              user,
              remainingAmount,
              orderAmount: total,
              currency: currencyCode,
              redvaultAvailable: redvaultAvailability.available,
              redvaultStatus,
              redvaultSummary: paymentSession.redvault.summary,
              redvaultOrderReady: Boolean(redvaultOrderReady),
            }}
          />

          <DesktopOrderSummary
            displayItems={displayItems}
            formatCurrencyAuto={formatCurrencyAuto}
            summarySubtotal={summarySubtotal}
            orderTotals={summaryAmounts.summaryOrderTotals}
            taxLabel={summaryAmounts.summaryTaxLabel}
            deliveryCost={summaryAmounts.summaryDeliveryCost}
            deliveryMethod={summaryAmounts.summaryDeliveryMethod}
            discountAmount={summaryAmounts.summaryDiscountAmount}
            selectedQuoteId={selectedQuoteId}
            giftWrappingCost={summaryAmounts.summaryGiftWrappingCost}
            paymentMethod={paymentMethod}
            walletCurrencySupported={paymentSession.wallet.currencySupported}
            walletRedemptionAllowed={paymentSession.wallet.redemptionAllowed}
            walletLoading={paymentSession.wallet.loading}
            walletBalance={paymentSession.wallet.balance}
            hasUser={Boolean(user)}
            currencySymbol={currencySymbol}
            payWithWallet={paymentSession.wallet.payWithWallet}
            setPayWithWallet={paymentSession.wallet.setPayWithWallet}
            walletAmountUsed={walletAmountUsed}
            remainingAmount={remainingAmount}
            checkoutPayWithWallet={paymentSession.checkoutValues.payWithWallet}
            redvaultSummary={paymentSession.redvault.summary}
            newsletterOptIn={newsletterOptIn}
            setNewsletterOptIn={setNewsletterOptIn}
            handlePlaceOrder={handlePlaceOrder}
            isProcessing={isProcessing}
            isPayForMeValid={isPayForMeValid}
          />
        </div>
      </div>

    </div >
  );
};
