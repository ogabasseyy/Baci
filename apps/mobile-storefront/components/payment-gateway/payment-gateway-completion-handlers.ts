import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  claimCheckoutPurchaseTracking,
  clearRedvaultPurchaseTrackingContext,
  loadRedvaultPurchaseTrackingContext,
} from '@/lib/claim-checkout-purchase-tracking';
import { clearPersistedRedvaultOrderWithRetry } from '@/lib/pending-redvault-order';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
import { verifyRedvaultPayment } from '@/services/redvault';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import { PAYMENT_KINDS } from './payment-gateway.helpers';
import {
  beginSavingsAuthorizationCompletion,
  beginWalletTopUpCompletion,
} from './payment-gateway-completions';
import type {
  PaymentGatewayRefs,
  PaymentStatusSetter,
} from './payment-gateway-controller.types';
import { handleVtuConfirmation } from './use-vtu-payment-completion';

interface PaymentGatewayCompletionHandlerInput
  extends Partial<PaymentGatewayParams> {
  clearCart: () => void | Promise<void>;
  clearPendingLoadTimeout: () => void;
  queryClient: QueryClient;
  refs: PaymentGatewayRefs;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
}

export function createPaymentGatewayCompletionHandlers({
  amount,
  clearCart,
  clearPendingLoadTimeout,
  customerIdentifier,
  gateway,
  merchantId,
  merchantSlug,
  orderId,
  orderNumber,
  paymentKind,
  paymentMethod,
  queryClient,
  reference,
  refs,
  returnTo,
  scheduleDelayedNavigation,
  setErrorMessage,
  setPaymentStatus,
  trackingToken,
  utilityType,
}: PaymentGatewayCompletionHandlerInput) {
  const {
    isMountedRef,
    paymentCompletionStartedRef,
    statusRef,
    vtuConfirmationTokenRef,
  } = refs;

  const isCurrentVtuConfirmation = (confirmationToken: number) =>
    isMountedRef.current &&
    vtuConfirmationTokenRef.current === confirmationToken;

  const beginVtuPaymentCompletion = (input?: {
    amount?: number;
    customerIdentifier?: string;
    reference?: string;
  }) => {
    const currentStatus = statusRef.current;
    if (
      paymentCompletionStartedRef.current ||
      currentStatus === 'processing' ||
      currentStatus === 'success'
    ) {
      return;
    }

    paymentCompletionStartedRef.current = true;
    clearPendingLoadTimeout();
    setPaymentStatus('processing');
    void handleVtuConfirmation({
      amount,
      customerIdentifier,
      fallbackAmount: input?.amount,
      fallbackCustomerIdentifier: input?.customerIdentifier,
      gateway,
      isMountedRef,
      isCurrentVtuConfirmation,
      nextReference: input?.reference ?? reference,
      scheduleDelayedNavigation,
      setErrorMessage,
      setStatus: setPaymentStatus,
      utilityType,
      vtuConfirmationTokenRef,
    });
  };

  const beginPaymentCompletion = async () => {
    const currentStatus = statusRef.current;
    if (
      paymentCompletionStartedRef.current ||
      currentStatus === 'processing' ||
      currentStatus === 'success'
    ) {
      return;
    }

    if (paymentKind === PAYMENT_KINDS.VTU) {
      beginVtuPaymentCompletion();
      return;
    }

    if (paymentKind === PAYMENT_KINDS.WALLET) {
      beginWalletTopUpCompletion({
        clearPendingLoadTimeout,
        gateway,
        merchantId,
        merchantSlug,
        queryClient,
        reference,
        refs,
        returnTo,
        scheduleDelayedNavigation,
        setErrorMessage,
        setPaymentStatus,
      });
      return;
    }

    if (paymentKind === PAYMENT_KINDS.SAVINGS_AUTH) {
      beginSavingsAuthorizationCompletion({
        clearPendingLoadTimeout,
        gateway,
        merchantId,
        merchantSlug,
        queryClient,
        reference,
        refs,
        returnTo,
        scheduleDelayedNavigation,
        setErrorMessage,
        setPaymentStatus,
      });
      return;
    }

    let verifiedOrderNumber = orderNumber;
    if (paymentMethod === 'uba_redvault') {
      paymentCompletionStartedRef.current = true;
      clearPendingLoadTimeout();
      setPaymentStatus('processing');
      try {
        const outcome = await verifyRedvaultPayment(reference || '');
        if (!isMountedRef.current) return;
        if (outcome === 'pending' || outcome === 'held') {
          setPaymentStatus(outcome);
          return;
        }
        verifiedOrderNumber = outcome.orderNumber || orderNumber;
        // The persisted fence must clear now: otherwise the next submit
        // resolves this paid order, clears the new cart, and routes back
        // here instead of placing the new purchase. Retry transient
        // storage failures before degrading to best-effort — verification
        // already succeeded, so cleanup must never revert to pending.
        try {
          await clearPersistedRedvaultOrderWithRetry();
        } catch {
          // A fence that will not clear is left for the next resolver
          // pass; the verified payment still succeeds below.
        }
        try {
          const trackingContext = await loadRedvaultPurchaseTrackingContext(
            orderId || ''
          );
          if (
            trackingContext &&
            (await claimCheckoutPurchaseTracking(orderId || ''))
          ) {
            trackCheckoutRoutePurchaseCompleted({
              ...trackingContext,
              orderId: orderId || '',
              orderNumber: verifiedOrderNumber || trackingContext.orderNumber,
            });
            await clearRedvaultPurchaseTrackingContext(orderId || '');
          }
        } catch {
          // Verification already succeeded; ignore analytics failures.
        }
      } catch {
        if (!isMountedRef.current) return;
        setErrorMessage(
          'We could not confirm your UBA payment yet. Do not pay again; check your orders shortly.'
        );
        setPaymentStatus('pending');
        return;
      }
    }

    paymentCompletionStartedRef.current = true;
    clearPendingLoadTimeout();
    setPaymentStatus('success');
    await clearCart();
    scheduleDelayedNavigation(() => {
      router.replace({
        pathname: '/order-success',
        params: {
          orderId: orderId || '',
          orderNumber: verifiedOrderNumber || '',
          paymentMethod: gateway,
          reference: reference || '',
          ...(trackingToken && { trackingToken }),
        },
      });
    });
  };

  return { beginPaymentCompletion, beginVtuPaymentCompletion };
}
