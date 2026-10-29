import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import { useToast } from '@/components/ui/Toast';
import { setClipboardString } from '@/lib/clipboard';
import { useAuthStore } from '@/stores/auth-store';
import { useCartStore } from '@/stores/cart-store';
import { createPaymentGatewayCloseHandler } from './create-payment-gateway-close-handler';
import {
  isPaymentGateway,
  PAYMENT_GATEWAY_LABELS,
} from './payment-gateway.helpers';
import {
  firstSearchParam,
  parsePaymentGatewayParams,
} from './payment-gateway-controller.helpers';
import type {
  PaymentGatewayRefs,
  PaymentGatewayStatus,
} from './payment-gateway-controller.types';
import { requiresServerCheckoutConfirmation } from './requires-server-checkout-confirmation';
import { usePaymentGatewayCompletionHandlers } from './use-payment-gateway-completion-handlers';
import { usePaymentGatewayEventHandlers } from './use-payment-gateway-event-handlers';
import { usePaymentGatewayMessageHandler } from './use-payment-gateway-message-handler';
import { usePaymentGatewayTimers } from './use-payment-gateway-timers';
import { useWalletPaystackCheckout } from './use-wallet-paystack-checkout';
export function usePaymentGatewayController() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<Record<string, string>>();
  // Raw amount string for the mount bind: the ownership check parses
  // decimal → integer kobo directly so binary-float rounding can never
  // turn a legitimate checkout into a fail-closed mismatch.
  const amountRaw = firstSearchParam(params.amount);
  const webViewRef = useRef<WebView>(null);
  const copiedGatewayTextRef = useRef<string | null>(null);
  const paymentCompletionStartedRef = useRef(false);
  const paymentFailureRecordedRef = useRef(false);
  const paymentFailureReferenceRef = useRef<string | undefined>(undefined);
  const savingsAuthorizationAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const vtuConfirmationTokenRef = useRef(0);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCart = useCartStore((state) => state.clearCart);
  const user = useAuthStore((state) => state.user);
  const customer = useAuthStore((state) => state.customer);
  const toast = useToast();
  const [status, setStatusState] = useState<PaymentGatewayStatus>('loading');
  const statusRef = useRef<PaymentGatewayStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Primary-card only: the recovered operation reference (never the raw
  // URL parameter) and the terminal new-funding directive. Both are set
  // exclusively by the card completion run that verified them.
  const [confirmedOperationReference, setConfirmedOperationReference] =
    useState<string | null>(null);
  const [terminalDirective, setTerminalDirective] = useState<string | null>(
    null
  );
  const gatewayRefs: PaymentGatewayRefs = {
    copiedGatewayTextRef,
    isMountedRef,
    loadTimeoutRef,
    navigationTimeoutRef,
    paymentCompletionStartedRef,
    paymentFailureRecordedRef,
    paymentFailureReferenceRef,
    savingsAuthorizationAbortRef,
    statusRef,
    vtuConfirmationTokenRef,
    webViewRef,
  };

  const setPaymentStatus = (
    nextStatus:
      | PaymentGatewayStatus
      | ((currentStatus: PaymentGatewayStatus) => PaymentGatewayStatus)
  ) => {
    const resolvedStatus =
      typeof nextStatus === 'function'
        ? nextStatus(statusRef.current)
        : nextStatus;
    statusRef.current = resolvedStatus;
    setStatusState(resolvedStatus);
  };

  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      savingsAuthorizationAbortRef.current?.abort();
      savingsAuthorizationAbortRef.current = null;
    },
    []
  );

  const validatedParams = parsePaymentGatewayParams(params);
  const isPaystackWallet =
    validatedParams.data?.paymentKind === 'wallet' &&
    validatedParams.data.gateway === 'paystack';
  const walletCheckout = useWalletPaystackCheckout({
    enabled: isPaystackWallet,
    setErrorMessage,
    setPaymentStatus,
    statusRef,
  });

  const {
    clearPendingLoadTimeout,
    clearPendingNavigation,
    scheduleDelayedNavigation,
    scheduleLoadTimeout,
  } = usePaymentGatewayTimers({
    onLoadTimeout: walletCheckout.onLoadTimeout,
    refs: gatewayRefs,
    setErrorMessage,
    setPaymentStatus,
  });

  const {
    amount,
    authorizationUrl,
    customerIdentifier,
    gateway,
    merchantId,
    merchantSlug,
    orderId,
    orderNumber,
    orderTotal,
    paymentKind,
    paymentMethod,
    reference,
    returnTo,
    trackingToken,
    utilityType,
  } = validatedParams.data || {};
  const gatewayName =
    gateway && isPaymentGateway(gateway)
      ? PAYMENT_GATEWAY_LABELS[gateway]
      : 'Payment';

  const { beginPaymentCompletion, beginVtuPaymentCompletion } =
    usePaymentGatewayCompletionHandlers({
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
      refs: gatewayRefs,
      returnTo,
      scheduleDelayedNavigation,
      setConfirmedOperationReference,
      setErrorMessage,
      setPaymentStatus,
      setTerminalDirective,
      trackingToken,
      utilityType,
    });

  const copyGatewayText = async (
    text: string,
    successMessage: string,
    failureMessage = 'Unable to copy text.'
  ) => {
    const copied = await setClipboardString(text);
    if (copied) {
      toast.success(successMessage);
    } else {
      toast.error(failureMessage);
    }
  };

  const handleGatewayMessage = usePaymentGatewayMessageHandler({
    amount,
    clearCart,
    confirmVtuPaymentSuccess: beginVtuPaymentCompletion,
    confirmServerPayment: requiresServerCheckoutConfirmation(
      paymentMethod,
      paymentKind
    )
      ? beginPaymentCompletion
      : undefined,
    copiedGatewayTextRef,
    copyGatewayText,
    customerIdentifier,
    gateway,
    orderId,
    orderNumber,
    orderTotal,
    paymentKind,
    reference,
    trackingToken,
    utilityType,
    markPaymentCompletionStarted: () => {
      if (paymentCompletionStartedRef.current) {
        return false;
      }
      paymentCompletionStartedRef.current = true;
      return true;
    },
    onTerminalVerificationFailure: (terminalFailure) => {
      paymentCompletionStartedRef.current = false;
      setPaymentStatus('error');
      setErrorMessage(
        terminalFailure === 'cancelled'
          ? 'Payment was cancelled before completion. You can try again.'
          : 'Payment could not be confirmed. Please try again.'
      );
    },
    scheduleDelayedNavigation,
    setProcessingStatus: () => setPaymentStatus('processing'),
    setSuccessStatus: () => setPaymentStatus('success'),
    isMountedRef,
  });

  const handleWebViewMessage = async (
    event: Parameters<typeof handleGatewayMessage>[0]
  ) => {
    if (walletCheckout.handleMessage(event.nativeEvent.data)) return;
    await handleGatewayMessage(event);
  };

  const handleClose = createPaymentGatewayCloseHandler({
    customerId: customer?.id,
    orderId,
    paymentKind,
    paymentMethod,
    trackingToken,
    userId: user?.id,
  });
  const eventHandlers = usePaymentGatewayEventHandlers({
    beginPaymentCompletion,
    paymentMethod,
    clearPendingLoadTimeout,
    clearPendingNavigation,
    gateway,
    orderId,
    paymentKind,
    reference,
    refs: gatewayRefs,
    returnTo,
    scheduleDelayedNavigation,
    scheduleLoadTimeout,
    setErrorMessage,
    setPaymentStatus,
  });

  return {
    amount,
    amountRaw,
    authorizationUrl,
    confirmedOperationReference,
    errorMessage,
    gatewayName,
    returnTo,
    terminalDirective,
    handleBack: handleClose,
    handleClose,
    ...eventHandlers,
    handleLoadStart: () => {
      walletCheckout.onLoadStart();
      eventHandlers.handleLoadStart();
    },
    handleLoadEnd: () => {
      eventHandlers.handleLoadEnd();
      walletCheckout.onLoadEnd();
    },
    handleCheckWalletPaymentStatus: beginPaymentCompletion,
    handleWalletCheckoutRecovery: () =>
      walletCheckout.showRecovery(clearPendingLoadTimeout),
    handleWebViewMessage,
    paymentMethod,
    paymentKind,
    status,
    toast,
    utilityType,
    validatedParams,
    walletCheckoutInteractive: walletCheckout.interactive,
    walletCheckoutStalled: walletCheckout.stalled,
    webViewRef,
  };
}
