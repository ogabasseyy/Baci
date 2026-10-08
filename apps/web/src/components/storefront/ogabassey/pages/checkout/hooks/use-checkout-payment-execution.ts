'use client';

import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
import type { useCheckoutAttemptSession } from './use-checkout-attempt-session';
import { useCheckoutCryptoSession } from './use-checkout-crypto-session';
import { useCheckoutDvaSession } from './use-checkout-dva-session';
import type { useCheckoutFormSession } from './use-checkout-form-session';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';
import { useCheckoutRedvaultAvailability } from './use-checkout-redvault-availability';
import { useStorefrontCustomerSession } from './use-storefront-customer-session';
import { useWalletFundedBankTransfer } from './use-wallet-funded-bank-transfer';
import { useWalletFundedOrderCompletion } from './use-wallet-funded-order-completion';

type Submission = CheckoutOrderSubmissionContext;

export interface CheckoutPaymentExecutionOptions {
  identity: {
    merchantId: string | null | undefined;
    merchantSlug: string | undefined;
    currencyCode: string;
  };
  form: {
    session: ReturnType<typeof useCheckoutFormSession>['form'];
    account: ReturnType<typeof useCheckoutFormSession>['account'];
    user: Submission['account']['user'];
  };
  cart: Submission['cart'];
  delivery: Omit<
    Submission['delivery'],
    | 'method'
    | 'airportType'
    | 'airportRequiresQuote'
    | 'newAddressStreet'
    | 'newAddressCity'
    | 'newAddressState'
  >;
  merchant: Submission['merchant'];
  navigation: {
    flow: Pick<
      Submission['navigation'],
      'setCurrentStep' | 'setCompletedSteps'
    >;
    pushSuccessRoute: Submission['navigation']['pushSuccessRoute'];
    getHref: Submission['navigation']['getHref'];
  };
  // REDVAULT availability is derived inside this hook (it already holds
  // the sanitized cart, merchant, and user), so callers do not pass it.
  payment: Omit<Submission['payment'], 'redvaultAvailable'>;
  attempt: Pick<
    ReturnType<typeof useCheckoutAttemptSession>,
    | 'resumedOrder'
    | 'preferredGateway'
    | 'resumeTrackingToken'
    | 'resumeMerchantSlug'
    | 'pendingCheckoutOrder'
    | 'clearPendingCheckoutOrder'
    | 'setPendingCheckoutOrder'
    | 'setCheckoutOrderCreated'
    | 'setIsProcessing'
    | 'isOrderInFlightRef'
    | 'tryBeginSubmission'
    | 'releaseSubmission'
    | 'handleSubmissionError'
  >;
}

/** Owns payment resources and submission around the authoritative checkout sessions. */
export function useCheckoutPaymentExecution({
  identity,
  form,
  cart,
  delivery,
  merchant,
  navigation,
  payment,
  attempt,
}: CheckoutPaymentExecutionOptions) {
  // The commerce checkout does not mount CustomerAuthProvider; resolve the
  // cookie-backed storefront session before choosing the wallet-funded path.
  const customerSession = useStorefrontCustomerSession(identity.merchantSlug);
  const dva = useCheckoutDvaSession({
    checkoutCart: cart.checkoutCart,
    clearCart: cart.clearCart,
    clearCheckoutSession: form.session.clear,
    clearPendingCheckoutOrder: attempt.clearPendingCheckoutOrder,
    currencyCode: identity.currencyCode,
    getHref: navigation.getHref,
    merchantSlug: identity.merchantSlug,
  });
  const crypto = useCheckoutCryptoSession({
    merchantId: identity.merchantId,
    clearCheckoutSession: form.session.clear,
    clearPendingCheckoutOrder: attempt.clearPendingCheckoutOrder,
    clearCart: cart.clearCart,
    getHref: navigation.getHref,
    isOrderInFlightRef: attempt.isOrderInFlightRef,
  });
  const completeWalletFundedOrder = useWalletFundedOrderCompletion({
    clearCart: cart.clearCart,
    clearCheckoutSession: form.session.clear,
    clearPendingCheckoutOrder: attempt.clearPendingCheckoutOrder,
    getHref: navigation.getHref,
    paymentMethod: payment.session.method,
  });
  const walletFundedTransfer = useWalletFundedBankTransfer({
    merchantId: identity.merchantId ?? undefined,
    merchantSlug: identity.merchantSlug,
    onOrderPaid: completeWalletFundedOrder,
  });
  // Pilot-aware REDVAULT availability, keyed on the sanitized checkout cart
  // (not the raw cart) plus merchant and session state.
  const { availability: redvaultAvailability } =
    useCheckoutRedvaultAvailability({
      cartItems: cart.checkoutCart,
      merchantId: identity.merchantId,
      merchantSlug: identity.merchantSlug,
      userId: form.user?.id,
      pilotFeeBlockers: {
        hasAssurance: cart.checkoutCart.some(
          (item) => item.hasAssurance === true
        ),
        shippingFee: delivery.session.quotes.selected?.price ?? 0,
        giftWrappingCost: delivery.giftWrappingCost,
      },
    });
  const { handlePlaceOrder } = useCheckoutOrderSubmission({
    account: {
      createAccount: form.account.createAccount,
      password: form.account.password,
      user: form.user,
      waitForResolvedCustomerAuth: customerSession.waitForResolvedAuthenticated,
    },
    cart,
    contact: {
      customerEmail: form.session.values.customerEmail,
      customerPhone: form.session.values.customerPhone,
      firstName: form.session.values.firstName,
      lastName: form.session.values.lastName,
      newsletterOptIn: form.session.values.newsletterOptIn,
    },
    delivery: {
      ...delivery,
      method: form.session.values.deliveryMethod,
      airportType: form.session.values.airportType,
      airportRequiresQuote: form.session.values.airportRequiresQuote,
      newAddressStreet: form.session.values.newAddressStreet,
      newAddressCity: form.session.values.newAddressCity,
      newAddressState: form.session.values.newAddressState,
    },
    merchant,
    navigation: {
      setCurrentStep: navigation.flow.setCurrentStep,
      setCompletedSteps: navigation.flow.setCompletedSteps,
      pushSuccessRoute: navigation.pushSuccessRoute,
      getHref: navigation.getHref,
    },
    order: {
      pending: attempt.pendingCheckoutOrder,
      clearPending: attempt.clearPendingCheckoutOrder,
      setPending: attempt.setPendingCheckoutOrder,
      setOrderCreated: attempt.setCheckoutOrderCreated,
      clearCheckoutSession: form.session.clear,
      setDvaData: dva.setDvaData,
      setIsInitializingDva: dva.setIsInitializingDva,
      setPendingCryptoOrder: crypto.setPendingCryptoOrder,
      setShowCryptoSelector: crypto.setShowCryptoSelector,
      setCryptoPaymentData: crypto.setCryptoPaymentData,
      walletFundedTransfer,
    },
    payment: {
      ...payment,
      redvaultAvailable: redvaultAvailability.available,
    },
    resumed: {
      order: attempt.resumedOrder,
      preferredGateway: attempt.preferredGateway,
      trackingToken: attempt.resumeTrackingToken,
      merchantSlugFromResume: attempt.resumeMerchantSlug,
    },
    processing: {
      setIsProcessing: attempt.setIsProcessing,
      isOrderInFlightRef: attempt.isOrderInFlightRef,
      tryBeginSubmission: attempt.tryBeginSubmission,
      releaseSubmission: attempt.releaseSubmission,
      handleSubmissionError: attempt.handleSubmissionError,
    },
  });

  return {
    crypto,
    dva,
    handlePlaceOrder,
    redvaultAvailable: redvaultAvailability.available,
    walletFundedTransfer,
  };
}
