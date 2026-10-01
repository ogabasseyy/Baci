'use client';

import { useCheckoutCryptoSession } from './use-checkout-crypto-session';
import { useCheckoutDvaSession } from './use-checkout-dva-session';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
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
    account: Omit<Submission['account'], 'waitForResolvedCustomerAuth'>;
    contact: Submission['contact'];
  };
  cart: Submission['cart'];
  delivery: Submission['delivery'];
  merchant: Submission['merchant'];
  navigation: Submission['navigation'];
  order: Pick<
    Submission['order'],
    | 'pending'
    | 'clearPending'
    | 'setPending'
    | 'setOrderCreated'
    | 'clearCheckoutSession'
  >;
  payment: Submission['payment'];
  attempt: Pick<Submission, 'resumed' | 'processing'>;
}

/** Owns payment resources and submission around the authoritative checkout sessions. */
export function useCheckoutPaymentExecution({
  identity,
  form,
  cart,
  delivery,
  merchant,
  navigation,
  order,
  payment,
  attempt,
}: CheckoutPaymentExecutionOptions) {
  // The commerce checkout does not mount CustomerAuthProvider; resolve the
  // cookie-backed storefront session before choosing the wallet-funded path.
  const customerSession = useStorefrontCustomerSession(identity.merchantSlug);
  const dva = useCheckoutDvaSession({
    checkoutCart: cart.checkoutCart,
    clearCart: cart.clearCart,
    clearCheckoutSession: order.clearCheckoutSession,
    clearPendingCheckoutOrder: order.clearPending,
    currencyCode: identity.currencyCode,
    getHref: navigation.getHref,
    merchantSlug: identity.merchantSlug,
  });
  const crypto = useCheckoutCryptoSession({
    merchantId: identity.merchantId,
    clearCheckoutSession: order.clearCheckoutSession,
    clearPendingCheckoutOrder: order.clearPending,
    clearCart: cart.clearCart,
    getHref: navigation.getHref,
    isOrderInFlightRef: attempt.processing.isOrderInFlightRef,
  });
  const completeWalletFundedOrder = useWalletFundedOrderCompletion({
    clearCart: cart.clearCart,
    clearCheckoutSession: order.clearCheckoutSession,
    clearPendingCheckoutOrder: order.clearPending,
    getHref: navigation.getHref,
    paymentMethod: payment.session.method,
  });
  const walletFundedTransfer = useWalletFundedBankTransfer({
    merchantId: identity.merchantId ?? undefined,
    merchantSlug: identity.merchantSlug,
    onOrderPaid: completeWalletFundedOrder,
  });
  const { handlePlaceOrder } = useCheckoutOrderSubmission({
    account: {
      ...form.account,
      waitForResolvedCustomerAuth:
        customerSession.waitForResolvedAuthenticated,
    },
    cart,
    contact: form.contact,
    delivery,
    merchant,
    navigation,
    order: {
      ...order,
      setDvaData: dva.setDvaData,
      setIsInitializingDva: dva.setIsInitializingDva,
      setPendingCryptoOrder: crypto.setPendingCryptoOrder,
      setShowCryptoSelector: crypto.setShowCryptoSelector,
      setCryptoPaymentData: crypto.setCryptoPaymentData,
      walletFundedTransfer,
    },
    payment,
    resumed: attempt.resumed,
    processing: attempt.processing,
  });

  return { crypto, dva, handlePlaceOrder, walletFundedTransfer };
}
