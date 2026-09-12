import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { PaymentGatewayParams } from '@/schemas/payment-gateway';
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
