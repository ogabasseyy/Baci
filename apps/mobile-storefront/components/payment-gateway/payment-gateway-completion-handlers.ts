import type { QueryClient } from '@tanstack/react-query';
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
import type { OrderCompletionContext } from './payment-gateway-order-completion';
import {
  settleOrderCompletion,
  verifyRedvaultCompletion,
} from './payment-gateway-order-completion';
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
  orderTotal,
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

    const completionContext: OrderCompletionContext = {
      amount,
      clearCart,
      clearPendingLoadTimeout,
      gateway,
      isMountedRef,
      orderId,
      orderNumber,
      orderTotal,
      paymentCompletionStartedRef,
      reference,
      scheduleDelayedNavigation,
      setErrorMessage,
      setPaymentStatus,
      trackingToken,
    };

    let verifiedOrderNumber = orderNumber;
    // A provider-confirmed REDVAULT payment completes exactly once below:
    // the REDVAULT branch owns the ad purchase emission, so the generic
    // verification block is skipped for it — otherwise a paid
    // tracked-order lookup would emit the same ad purchase and legacy
    // order_completed a second time under the other claim key. The
    // funnel payment_completed is still emitted in the shared
    // completion under its own claim.
    let redvaultVerified = false;
    if (paymentMethod === 'uba_redvault') {
      const outcome = await verifyRedvaultCompletion(completionContext);
      if (!outcome.continueSharedCompletion) {
        return;
      }
      verifiedOrderNumber = outcome.verifiedOrderNumber;
      redvaultVerified = true;
    }

    await settleOrderCompletion(
      completionContext,
      verifiedOrderNumber,
      redvaultVerified
    );
  };

  return { beginPaymentCompletion, beginVtuPaymentCompletion };
}
