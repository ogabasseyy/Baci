import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { WebView } from 'react-native-webview';
import { useToast } from '@/components/ui/Toast';
import { setClipboardString } from '@/lib/clipboard';
import { useCartStore } from '@/stores/cart-store';
import { createPaymentGatewayMessageHandler } from './create-payment-gateway-message-handler';
import {
  isPaymentGateway,
  PAYMENT_GATEWAY_LABELS,
} from './payment-gateway.helpers';
import { createPaymentGatewayCompletionHandlers } from './payment-gateway-completion-handlers';
import {
  getCloseConfirmationMessage,
  parsePaymentGatewayParams,
} from './payment-gateway-controller.helpers';
import type {
  PaymentGatewayRefs,
  PaymentGatewayStatus,
} from './payment-gateway-controller.types';
import { createPaymentGatewayEventHandlers } from './payment-gateway-event-handlers';
import { createPaymentGatewayTimers } from './payment-gateway-timers';

// React Compiler forbids passing refs to plain function calls during render but
// allows passing them to hooks. These wrappers classify the render-time handler
// factories as hooks; like before, they re-run on every render.
function usePaymentGatewayTimers(
  input: Parameters<typeof createPaymentGatewayTimers>[0]
) {
  return createPaymentGatewayTimers(input);
}

function usePaymentGatewayMessageHandler(
  input: Parameters<typeof createPaymentGatewayMessageHandler>[0]
) {
  return createPaymentGatewayMessageHandler(input);
}

function usePaymentGatewayEventHandlers(
  input: Parameters<typeof createPaymentGatewayEventHandlers>[0]
) {
  return createPaymentGatewayEventHandlers(input);
}

function usePaymentGatewayCompletionHandlers(
  input: Parameters<typeof createPaymentGatewayCompletionHandlers>[0]
) {
  return createPaymentGatewayCompletionHandlers(input);
}

export function usePaymentGatewayController() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<Record<string, string>>();
  const webViewRef = useRef<WebView>(null);
  const copiedGatewayTextRef = useRef<string | null>(null);
  const paymentCompletionStartedRef = useRef(false);
  const savingsAuthorizationAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const vtuConfirmationTokenRef = useRef(0);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCart = useCartStore((state) => state.clearCart);
  const toast = useToast();
  const [status, setStatusState] = useState<PaymentGatewayStatus>('loading');
  const statusRef = useRef<PaymentGatewayStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const gatewayRefs: PaymentGatewayRefs = {
    copiedGatewayTextRef,
    isMountedRef,
    loadTimeoutRef,
    navigationTimeoutRef,
    paymentCompletionStartedRef,
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

  const {
    clearPendingLoadTimeout,
    clearPendingNavigation,
    scheduleDelayedNavigation,
    scheduleLoadTimeout,
  } = usePaymentGatewayTimers({
    refs: gatewayRefs,
    setErrorMessage,
    setPaymentStatus,
  });

  const validatedParams = parsePaymentGatewayParams(params);

  const {
    amount,
    authorizationUrl,
    customerIdentifier,
    gateway,
    merchantId,
    merchantSlug,
    orderId,
    orderNumber,
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
      paymentKind,
      paymentMethod,
      queryClient,
      reference,
      refs: gatewayRefs,
      returnTo,
      scheduleDelayedNavigation,
      setErrorMessage,
      setPaymentStatus,
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

  const handleWebViewMessage = usePaymentGatewayMessageHandler({
    amount,
    clearCart,
    confirmVtuPaymentSuccess: beginVtuPaymentCompletion,
    confirmRedvaultPayment:
      paymentMethod === 'uba_redvault' ? beginPaymentCompletion : undefined,
    copiedGatewayTextRef,
    copyGatewayText,
    customerIdentifier,
    gateway,
    orderId,
    orderNumber,
    paymentKind,
    reference,
    trackingToken,
    utilityType,
    markPaymentCompletionStarted: () => {
      paymentCompletionStartedRef.current = true;
    },
    scheduleDelayedNavigation,
    setSuccessStatus: () => setPaymentStatus('success'),
  });

  const handleClose = () => {
    Alert.alert('Cancel Payment?', getCloseConfirmationMessage(paymentKind), [
      { text: 'Continue Payment', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  };
  const eventHandlers = usePaymentGatewayEventHandlers({
    beginPaymentCompletion,
    paymentMethod,
    clearPendingLoadTimeout,
    clearPendingNavigation,
    paymentKind,
    refs: gatewayRefs,
    returnTo,
    scheduleDelayedNavigation,
    scheduleLoadTimeout,
    setErrorMessage,
    setPaymentStatus,
  });

  return {
    amount,
    authorizationUrl,
    errorMessage,
    gatewayName,
    // Alias retained for checkout back-button consumers; both paths confirm cancellation.
    handleBack: handleClose,
    handleClose,
    ...eventHandlers,
    handleWebViewMessage,
    paymentMethod,
    paymentKind,
    status,
    toast,
    utilityType,
    validatedParams,
    webViewRef,
  };
}
