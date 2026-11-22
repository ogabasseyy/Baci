'use client';
import type React from 'react';
import { CheckoutReplay } from '@/components/analytics/checkout-replay';
import { useCart } from '@/hooks/cart';
import { useCurrency } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import type { BrowserBankCardOffer } from '@/lib/checkout/get-browser-bank-card-offers';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { checkoutDeliveryFormFields } from './checkout/checkout-delivery-form-fields';
import { BankCardOfferOptionsContext } from './checkout/components/bank-card-offer-options-context';
import { CheckoutCartScreen } from './checkout/components/CheckoutCartScreen';
import { getCheckoutPageResumeFallback } from './checkout/components/get-checkout-page-resume-fallback';
import { deriveCheckoutCartModel } from './checkout/derive-checkout-cart-model';
import { deriveCheckoutScreenModel } from './checkout/derive-checkout-screen-model';
import { useBrowserBankCardOffer } from './checkout/hooks/use-browser-bank-card-offer';
import { useCheckoutAttemptSession } from './checkout/hooks/use-checkout-attempt-session';
import { useCheckoutDeliverySession } from './checkout/hooks/use-checkout-delivery-session';
import { useCheckoutFinancialSession } from './checkout/hooks/use-checkout-financial-session';
import { useCheckoutFormSession } from './checkout/hooks/use-checkout-form-session';
import { useCheckoutNavigation } from './checkout/hooks/use-checkout-navigation';
import { useCheckoutPaymentExecution } from './checkout/hooks/use-checkout-payment-execution';
import { useCheckoutScrollTop } from './checkout/hooks/use-checkout-scroll-top';
import { useCheckoutUser } from './checkout/hooks/use-checkout-user';
import type { OxygenCheckoutSlots } from './checkout/oxygen-checkout-slots';
import { checkoutPaymentRails } from './checkout/payment-rail-availability';

export type { OxygenCheckoutSlots } from './checkout/oxygen-checkout-slots';
export const CheckoutPage: React.FC<
  OxygenCheckoutSlots & { bankCardOffers?: readonly BrowserBankCardOffer[] }
> = ({ bankCardOffers = [], ...oxygenSlots }) => {
  const {
    cart,
    clearCart,
    isHydrated: isCartHydrated,
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
  const { searchParams, isHydrated, getHref, routerPush, pushSuccessRoute } =
    useCheckoutNavigation({
      basePath,
      isCartHydrated,
      merchantSlug: merchant?.slug,
    });
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
      routerPush,
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
    isOrderInFlightRef,
    resumedOrder,
  } = checkoutAttempt;

  // Prefer the persisted fee on resume (deep-link URLs omit giftWrappingCost).
  const giftWrappingCost =
    resumedOrder?.gift_wrapping_fee ??
    (Number(searchParams.get('giftWrappingCost')) || 0);

  const delivery = useCheckoutDeliverySession({
    ...checkoutDeliveryFormFields(checkoutForm),
    completedSteps,
    inferredLocation,
    isHydrated,
    merchantId: merchant?.id,
    merchantCountry,
    merchantSlug: merchant?.slug,
    checkoutCart,
    checkoutCartCatalogSubtotal,
    quoteItemsFingerprint,
    currentStep,
    setCurrentStep,
    setCheckoutField,
    setCheckoutFields,
  });

  const { orderTotals, paymentSession, summaryAmounts } =
    useCheckoutFinancialSession({
      merchant,
      effectiveItemSubtotal: checkoutDisplay.effectiveItemSubtotal,
      effectiveCheckoutCartTotal: checkoutDisplay.effectiveCheckoutCartTotal,
      deliveryCost: delivery.cost,
      deliveryMethod: checkoutForm.deliveryMethod,
      giftWrappingCost,
      hasCheckoutCartItems: checkoutDisplay.hasCheckoutCartItems,
      recoverCart: isHydrated && sharedCartEnabled && checkoutCart.length === 0,
      resumedOrder: checkoutDisplay.summaryOrder,
      clearPendingCheckoutOrder,
      currencyCode,
      discountSubtotal: checkoutDisplay.effectiveCheckoutCartTotal,
      hasAuthenticatedUser: Boolean(user),
      isOrderInFlightRef,
      merchantSlug: merchant?.slug ?? undefined,
      pendingCheckoutOrder,
      walletSessionUserId: user?.id,
      resumeOrderId,
      preferredGateway,
    });

  const bankCards = useBrowserBankCardOffer({
    offers: bankCardOffers,
    isOrderInFlightRef,
    financial: { paymentSession, summaryAmounts },
    formatCurrency: formatCurrencyAuto,
    cart: checkoutCart,
    fees: [delivery.cost, orderTotals?.taxAmount ?? 0, giftWrappingCost],
    buyer: {
      pendingOrder: pendingCheckoutOrder,
      merchantId: merchant?.id,
      checkoutEmail: checkoutForm.customerEmail,
      accountEmail: user?.email,
      paystackAvailable: paystackCheckoutAvailable,
      currency: currencyCode,
    },
    available: Boolean(
      !checkoutSharedCartRef &&
        !resumeOrderId &&
        !paymentSession.discount.code &&
        !paymentSession.checkoutValues.useWalletCredit &&
        !checkoutCart.some((item) => item.negotiatedPrice !== undefined)
    ),
  });
  useCheckoutScrollTop();

  const {
    crypto,
    dva,
    handlePlaceOrder: placeOrder,
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
      effectiveItemSubtotal: checkoutDisplay.effectiveItemSubtotal,
      taxAmount: orderTotals?.taxAmount ?? 0,
    },
    merchant,
    navigation: {
      flow: checkoutFlow,
      pushSuccessRoute,
      getHref,
    },
    payment: {
      session: bankCards.presentation.paymentSession,
      bankCardOffer: bankCards.offer ?? undefined,
      recoverSavedOffer: bankCards.recoverSavedOffer,
      bankTransferAvailable: bankTransferCheckoutAvailable,
      paystackAvailable: paystackCheckoutAvailable,
      korapayAvailable: korapayCheckoutAvailable,
      currencyCode,
    },
    attempt: checkoutAttempt,
  });
  const resumeFallback = getCheckoutPageResumeFallback({
    checkoutAttempt,
    cartEmpty: checkoutCart.length === 0,
    isHydrated,
    requestedOxygenId: searchParams.get('oxygenOrderId'),
    verifiedOxygenOrderId: oxygenSlots.verifiedOxygenOrderId,
    navigate: (path) => routerPush(getHref(path)),
  });
  if (resumeFallback) return resumeFallback;
  const screenModel = deriveCheckoutScreenModel({
    sessions: {
      form: checkoutFormSession,
      attempt: checkoutAttempt,
      delivery,
      financial: bankCards.presentation,
      execution: {
        crypto,
        dva,
        handlePlaceOrder: async () => bankCards.submit(placeOrder),
        walletFundedTransfer,
      },
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
      onReturnToCart: () => routerPush(getHref('/cart')),
    },
    availability: {
      oxygenAllowed,
      redvaultAvailable,
    },
  });
  return (
    <BankCardOfferOptionsContext.Provider value={bankCards.model}>
      {merchant?.slug === 'ogabassey' &&
        currentStep === 'payment' &&
        !searchParams.has('orderId') &&
        !searchParams.has('oxygenOrderId') && <CheckoutReplay />}
      <CheckoutCartScreen
        model={{ ...screenModel, ...oxygenSlots }}
        order={resumedOrder}
        requestedId={searchParams.get('orderId')}
        verifiedOxygenOrderId={oxygenSlots.verifiedOxygenOrderId}
        requestedOxygenId={searchParams.get('oxygenOrderId')}
      />
    </BankCardOfferOptionsContext.Provider>
  );
};
