'use client';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { usePrivateSearchParams } from '@/hooks/use-private-search-params';
import { asRoute } from '@/lib/routes';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { checkoutHref } from './checkout/checkout-href';
import { CheckoutCartScreen } from './checkout/components/CheckoutCartScreen';
import { CheckoutResumeFallback } from './checkout/components/CheckoutResumeFallback';
import { deriveCheckoutCartModel } from './checkout/derive-checkout-cart-model';
import { deriveCheckoutScreenModel } from './checkout/derive-checkout-screen-model';
import { useCheckoutAttemptSession } from './checkout/hooks/use-checkout-attempt-session';
import { useCheckoutDeliverySession } from './checkout/hooks/use-checkout-delivery-session';
import { useCheckoutFinancialSession } from './checkout/hooks/use-checkout-financial-session';
import { useCheckoutFormSession } from './checkout/hooks/use-checkout-form-session';
import { useCheckoutPaymentExecution } from './checkout/hooks/use-checkout-payment-execution';
import { useCheckoutScrollTop } from './checkout/hooks/use-checkout-scroll-top';
import { useCheckoutUser } from './checkout/hooks/use-checkout-user';
import { navigateCheckoutResult } from './checkout/navigate-checkout-result';
import type { OxygenCheckoutSlots } from './checkout/oxygen-checkout-slots';
import { checkoutPaymentRails } from './checkout/payment-rail-availability';
import { shouldShowResumeGate } from './checkout/should-show-resume-gate';

export type { OxygenCheckoutSlots } from './checkout/oxygen-checkout-slots';
export const CheckoutPage: React.FC<OxygenCheckoutSlots> = (oxygenSlots) => {
  const {
    cart,
    clearCart,
    isHydrated,
    removeFromCart,
    sharedCartRef,
    sharedCartEnabled,
    refreshSharedCart,
    syncStatus: sharedCartSyncStatus,
  } = useCart();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const merchantCountry = (merchant?.country?.trim() || 'NG').toUpperCase();
  const { formatCurrencyAuto, currencySymbol, currencyCode } = useCurrency();
  const hasPriceNegotiation = hasStorefrontPriceNegotiation(merchant);
  const {
    checkoutCart,
    checkoutCartCatalogSubtotal,
    checkoutCartTotal,
    itemSubtotal,
    quoteItemsFingerprint,
    sharedCartRef: checkoutSharedCartRef,
  } = deriveCheckoutCartModel(cart, hasPriceNegotiation, sharedCartRef);
  const {
    paystackCheckoutAvailable,
    korapayCheckoutAvailable,
    bankTransferCheckoutAvailable,
  } = checkoutPaymentRails(merchant, currencyCode);
  const basePath = merchantContext?.basePath;
  const router = useRouter();
  const getHref = (path: string) => checkoutHref(basePath, path);
  const searchParams = usePrivateSearchParams();
  const user = useCheckoutUser();
  const checkoutFormSession = useCheckoutFormSession({ isHydrated, user });
  const {
    form: checkoutFormState,
    flow: checkoutFlow,
    account,
  } = checkoutFormSession;
  const {
    values: checkoutForm,
    setField: setCheckoutField,
    setFields: setCheckoutFields,
    clear: clearCheckoutSession,
    inferredLocation,
  } = checkoutFormState;
  const { currentStep, completedSteps, setCurrentStep, setCompletedSteps } =
    checkoutFlow;
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
    airportRequiresQuote: checkoutForm.airportRequiresQuote,
    airportType: checkoutForm.airportType,
    completedSteps,
    inferredLocation,
    isHydrated,
    merchantId: merchant?.id,
    merchantCountry,
    merchantSlug: merchant?.slug,
    checkoutCart,
    checkoutCartCatalogSubtotal,
    quoteItemsFingerprint,
    deliveryCoordinates: checkoutForm.deliveryCoordinates,
    persistedSelectedQuoteId: checkoutForm.selectedQuoteId,
    persistedSelectedProviderRateId: checkoutForm.selectedProviderRateId,
    currentStep,
    setCurrentStep,
    setCheckoutField,
    setCheckoutFields,
    deliveryMethod: checkoutForm.deliveryMethod,
    newAddressStreet: checkoutForm.newAddressStreet,
    newAddressState: checkoutForm.newAddressState,
    newAddressCity: checkoutForm.newAddressCity,
    customerPhone: checkoutForm.customerPhone,
    firstName: checkoutForm.firstName,
    lastName: checkoutForm.lastName,
    customerEmail: checkoutForm.customerEmail,
  });
  const { cost: deliveryCost } = delivery;

  const { orderTotals, paymentSession, summaryAmounts } =
    useCheckoutFinancialSession({
      merchant,
      effectiveItemSubtotal,
      effectiveCheckoutCartTotal,
      deliveryCost,
      deliveryMethod: checkoutForm.deliveryMethod,
      giftWrappingCost,
      hasCheckoutCartItems,
      recoverCart: isHydrated && sharedCartEnabled && checkoutCart.length === 0,
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

  useCheckoutScrollTop();

  const {
    crypto,
    dva,
    handlePlaceOrder,
    oxygenAllowed,
    redvaultAvailable,
    walletFundedTransfer,
  } = useCheckoutPaymentExecution({
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
      sharedCartRef: checkoutSharedCartRef,
      sharedCartEnabled,
      refreshSharedCart,
      sharedCartSyncStatus,
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
      pushSuccessRoute: (url) =>
        navigateCheckoutResult(
          url,
          (path) => router.push(asRoute(path)),
          (path) => window.location.assign(path)
        ),
      getHref,
    },
    payment: {
      session: paymentSession,
      bankTransferAvailable: bankTransferCheckoutAvailable,
      paystackAvailable: paystackCheckoutAvailable,
      korapayAvailable: korapayCheckoutAvailable,
      currencyCode,
    },
    attempt: checkoutAttempt,
  });
  const isAutoTriggerProcessing =
    isHydrated &&
    checkoutCart.length === 0 &&
    resumedOrder &&
    !!preferredGateway &&
    !isProcessing;
  if (
    shouldShowResumeGate(
      checkoutCart.length === 0,
      isLoadingResumedOrder,
      Boolean(isAutoTriggerProcessing),
      Boolean(resumeOrderId && resumeOrderError),
      oxygenSlots.verifiedOxygenOrderId,
      searchParams.get('oxygenOrderId')
    )
  ) {
    return (
      <CheckoutResumeFallback
        cartEmpty={checkoutCart.length === 0}
        isAutoTriggerProcessing={isAutoTriggerProcessing}
        isLoadingResumedOrder={isLoadingResumedOrder}
        navigate={(path) => router.push(asRoute(getHref(path)))}
        resumeOrderError={resumeOrderError}
        resumeOrderId={resumeOrderId}
        resumedOrderId={resumedOrder?.id}
      />
    );
  }
  const screenModel = deriveCheckoutScreenModel({
    sessions: {
      form: checkoutFormSession,
      attempt: checkoutAttempt,
      delivery,
      financial: { paymentSession, summaryAmounts },
      execution: { crypto, dva, handlePlaceOrder, walletFundedTransfer },
    },
    display: {
      checkoutDisplay,
      checkoutCart,
      isHydrated,
      sharedCartEnabled,
      sharedCartRef: checkoutSharedCartRef,
    },
    identity: {
      merchant,
      user,
      currencyCode,
      currencySymbol,
      merchantCountry,
      formatCurrencyAuto,
    },
    actions: {
      onReturnToCart: () => router.push(asRoute(getHref('/cart'))),
    },
    availability: {
      oxygenAllowed,
      redvaultAvailable,
    },
  });
  return (
    <CheckoutCartScreen
      model={{ ...screenModel, ...oxygenSlots }}
      order={resumedOrder}
      requestedId={searchParams.get('orderId')}
      verifiedOxygenOrderId={oxygenSlots.verifiedOxygenOrderId}
      requestedOxygenId={searchParams.get('oxygenOrderId')}
    />
  );
};
