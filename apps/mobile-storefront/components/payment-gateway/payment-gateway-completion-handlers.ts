import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
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
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

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
  orderTotal,
  paymentKind,
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

    paymentCompletionStartedRef.current = true;
    clearPendingLoadTimeout();
    setPaymentStatus('success');
    if (orderId) {
      // Prefer the canonical order total: `amount` is only the residual due
      // at the gateway after wallet/savings credits.
      const purchaseTotal = orderTotal ?? amount ?? 0;
      // A completion-looking redirect proves association, not settlement:
      // only a server-confirmed paid order records the conversion here.
      // Unverified orders still navigate to success, where settlement
      // polling may complete them once the webhook marks them paid.
      const verification = await verifyOrderPaymentForCompletion({
        orderId,
        trackingToken,
        reference,
      });
      if (verification.paid) {
        // The tracked order already carries the checkout identity,
        // breakdown, and line items: forward them so the durable claim is
        // consumed with full attribution (later polling cannot enrich it).
        // First completion wins the durable claim; replays emit nothing.
        await trackCheckoutPaymentCompletedOnce({
          customerEmail: verification.customerEmail,
          customerPhone: verification.customerPhone,
          items: verification.items,
          orderId,
          orderNumber: orderNumber || orderId,
          paymentMethod: gateway || 'payment_gateway',
          reference,
          shipping: verification.shipping,
          subtotal: verification.subtotal,
          tax: verification.tax,
          value: verification.total ?? purchaseTotal,
        });
      }
    }
    await clearCart();
    scheduleDelayedNavigation(() => {
      router.replace({
        pathname: '/order-success',
        params: {
          orderId: orderId || '',
          orderNumber: orderNumber || '',
          paymentMethod: gateway,
          reference: reference || '',
          ...(trackingToken && { trackingToken }),
        },
      });
    });
  };

  return { beginPaymentCompletion, beginVtuPaymentCompletion };
}
