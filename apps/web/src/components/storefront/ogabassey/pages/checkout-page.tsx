'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { useEffect } from 'react';
import { useAuthSafe } from '@/contexts/auth-context';
import { useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';
import { asRoute } from '@/lib/routes';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { CheckoutResumeStatus } from './checkout/components/CheckoutResumeStatus';
import { CheckoutScreen } from './checkout/components/CheckoutScreen';
import { isNgnChargeCurrency } from './checkout/components/payment-step-availability';
import { deriveCheckoutCartModel } from './checkout/derive-checkout-cart-model';
import { deriveCheckoutOrderSummaryPresentation } from './checkout/derive-checkout-order-summary-presentation';
import { useCheckoutAttemptSession } from './checkout/hooks/use-checkout-attempt-session';
import { useCheckoutDeliverySession } from './checkout/hooks/use-checkout-delivery-session';
import { useCheckoutFinancialSession } from './checkout/hooks/use-checkout-financial-session';
import { useCheckoutFormSession } from './checkout/hooks/use-checkout-form-session';
import { useCheckoutPaymentExecution } from './checkout/hooks/use-checkout-payment-execution';
import { useRedvaultPaymentAvailability } from './checkout/hooks/use-redvault-payment-availability';
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
    path.startsWith('http')
      ? path
      : `${basePath || ''}${path === '/' ? '' : path}`;

  const searchParams = useSearchParams();
  const auth = useAuthSafe();
  const user = auth?.user;

  const checkoutFormSession = useCheckoutFormSession({ isHydrated, user });
  const {
    form: checkoutFormState,
    flow: checkoutFlow,
    account,
    auth: checkoutAuth,
  } = checkoutFormSession;
  const {
    values: checkoutForm,
    setField: setCheckoutField,
    setFields: setCheckoutFields,
    clear: clearCheckoutSession,
    inferredLocation,
    setNewsletterOptIn,
  } = checkoutFormState;

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
  } = checkoutForm;

  const { currentStep, completedSteps, setCurrentStep, setCompletedSteps } =
    checkoutFlow;
  // Mobile app order resume state
  // When opening from mobile app with ?orderId=xxx&gateway=credpal, we resume that order
  const checkoutAttempt = useCheckoutAttemptSession({
    searchParams,
    merchantId: merchant?.id,
    merchantSlug: merchant?.slug,
    merchantChargeCurrency: currencyCode,
    isHydrated,
    form: { setCheckoutFields, clearCheckoutSession },
    navigation: {
      setCurrentStep,
      setCompletedSteps,
      routerPush: (url) => router.push(asRoute(url)),
      getHref,
    },
    funnel: {
      checkoutCart,
      checkoutCartTotal,
      itemSubtotal,
      currencyCode,
    },
  });
  const {
    pendingCheckoutOrder,
    clearPendingCheckoutOrder,
    displayModel: checkoutDisplay,
    resumeOrderId,
    preferredGateway,
    isProcessing,
    isOrderInFlightRef,
    resumedOrder,
    isLoadingResumedOrder,
    resumeOrderError,
  } = checkoutAttempt;
  const {
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal,
    hasCheckoutCartItems,
    summaryOrder,
  } = checkoutDisplay;

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
  const { quotes: deliveryQuotes, cost: deliveryCost } = delivery;
  const { selectedId: selectedQuoteId } = deliveryQuotes;

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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const paymentMethod = paymentSession.method;
  const redvaultOrderReady = paymentSession.redvault.orderReady;
  const walletAmountUsed = paymentSession.wallet.amountUsed;
  const remainingAmount = paymentSession.wallet.remainingAmount;

  const { crypto, dva, handlePlaceOrder, walletFundedTransfer } =
    useCheckoutPaymentExecution({
      identity: {
        merchantId: merchant?.id,
        merchantSlug: merchant?.slug ?? undefined,
        currencyCode,
      },
      form: {
        session: checkoutFormState,
        account,
        user,
      },
      cart: {
        cart,
        checkoutCart,
        checkoutCartTotal,
        clearCart,
        removeFromCart,
      },
      delivery: {
        session: delivery,
        merchantCountry,
        giftWrappingCost,
        effectiveItemSubtotal,
        taxAmount: orderTotals?.taxAmount ?? 0,
      },
      merchant,
      navigation: {
        flow: checkoutFlow,
        pushSuccessRoute: (url) => router.push(asRoute(url)),
        getHref,
      },
      payment: {
        session: paymentSession,
        bankTransferAvailable: bankTransferCheckoutAvailable,
        paystackAvailable: paystackCheckoutAvailable,
        korapayAvailable: korapayCheckoutAvailable,
        redvaultAvailable: redvaultAvailability.available,
        currencyCode,
      },
      attempt: checkoutAttempt,
    });

  const isPayForMeValid = paymentSession.payForMe.isValid;
  const orderSummaryPresentation = deriveCheckoutOrderSummaryPresentation({
    display: checkoutDisplay,
    amounts: summaryAmounts,
    formatCurrencyAuto,
    paymentMethod,
    selectedQuoteId,
    wallet: {
      currencySupported: paymentSession.wallet.currencySupported,
      redemptionAllowed: paymentSession.wallet.redemptionAllowed,
      loading: paymentSession.wallet.loading,
      balance: paymentSession.wallet.balance,
      payWithWallet: paymentSession.wallet.payWithWallet,
      setPayWithWallet: paymentSession.wallet.setPayWithWallet,
      amountUsed: walletAmountUsed,
      remainingAmount,
      checkoutPayWithWallet: paymentSession.checkoutValues.payWithWallet,
    },
    hasUser: Boolean(user),
    currencySymbol,
    redvaultSummary: paymentSession.redvault.summary,
    newsletterOptIn,
    setNewsletterOptIn,
    handlePlaceOrder,
    isProcessing,
    isPayForMeValid,
    merchantId: merchant?.id || '',
    merchantCountry: merchant?.country ?? 'NG',
    payoutCurrency: merchant?.payout_currency ?? null,
    productIds: checkoutCart.map((item) => item.id),
    resumeOrderId,
    hasResumedOrder: Boolean(resumedOrder),
  });

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

  const checkoutScreenSteps = {
    flow: checkoutFlow,
    onSignIn: checkoutAuth.open,
    contact: {
      values: checkoutFormState.contactValues,
      onChange: setCheckoutField,
      onComplete: checkoutFlow.completeContact,
      account,
    },
    delivery: {
      session: delivery,
      address: {
        street: newAddressStreet,
        city: newAddressCity,
        state: newAddressState,
        merchantCountry,
        isHydrated,
      },
    },
    payment: {
      session: paymentSession,
      isProcessing,
      isPayForMeValid,
      isInitializingDva: dva.isInitializingDva,
      newsletterOptIn,
      setNewsletterOptIn,
      handlePlaceOrder,
      merchant,
      user,
      currency: currencyCode,
      redvaultAvailable: redvaultAvailability.available,
      redvaultOrderReady: Boolean(redvaultOrderReady),
    },
  };

  return (
    <CheckoutScreen
      page={{
        onReturnToCart: () => router.push(asRoute(getHref('/cart'))),
        merchantName: merchant?.business_name,
        formatCurrency: formatCurrencyAuto,
      }}
      auth={{
        isOpen: checkoutAuth.isOpen,
        onOpenChange: checkoutAuth.onOpenChange,
        onSuccess: checkoutAuth.close,
      }}
      overlays={{
        crypto,
        walletFundedTransfer,
        dva: {
          data: dva.dvaData,
          isVerifying: dva.isVerifyingDva,
          onClose: dva.closeDvaModal,
          onConfirmTransfer: dva.handleDvaConfirmTransfer,
        },
      }}
      summary={{
        presentation: orderSummaryPresentation,
        payment: paymentSession,
      }}
      steps={checkoutScreenSteps}
    />
  );
};
