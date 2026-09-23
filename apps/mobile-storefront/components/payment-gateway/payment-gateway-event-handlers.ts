import { type Href, router } from 'expo-router';
import type { WebViewNavigation } from 'react-native-webview';
import {
  isPaymentCancellationRedirect,
  isPaymentCompletionRedirect,
  PAYMENT_KINDS,
} from './payment-gateway.helpers';
import type {
  PaymentGatewayRefs,
  PaymentStatusSetter,
  WebViewErrorEvent,
} from './payment-gateway-controller.types';

interface PaymentGatewayEventHandlerInput {
  beginPaymentCompletion: () => void;
  clearPendingLoadTimeout: () => void;
  clearPendingNavigation: () => void;
  paymentKind?: string;
  paymentMethod?: string;
  refs: PaymentGatewayRefs;
  returnTo?: string;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  scheduleLoadTimeout: () => void;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
}

const terminalStatuses = new Set([
  'error',
  'processing',
  'pending',
  'held',
  'success',
]);

export function createPaymentGatewayEventHandlers({
  beginPaymentCompletion,
  clearPendingLoadTimeout,
  clearPendingNavigation,
  paymentKind,
  paymentMethod,
  refs,
  returnTo,
  scheduleDelayedNavigation,
  scheduleLoadTimeout,
  setErrorMessage,
  setPaymentStatus,
}: PaymentGatewayEventHandlerInput) {
  const isTerminalStatus = () => terminalStatuses.has(refs.statusRef.current);

  return {
    handleLoadEnd: () => {
      clearPendingLoadTimeout();
      setPaymentStatus((currentStatus) =>
        terminalStatuses.has(currentStatus) ? currentStatus : 'ready'
      );
    },
    handleLoadStart: () => {
      if (isTerminalStatus()) {
        return;
      }
      setErrorMessage(null);
      scheduleLoadTimeout();
      setPaymentStatus((currentStatus) =>
        terminalStatuses.has(currentStatus) ? currentStatus : 'loading'
      );
    },
    handleNavigationChange: (navState: WebViewNavigation) => {
      if (
        refs.statusRef.current === 'processing' ||
        refs.statusRef.current === 'success'
      ) {
        return;
      }
      if (isPaymentCompletionRedirect(navState.url)) {
        beginPaymentCompletion();
        return;
      }
      if (isPaymentCancellationRedirect(navState.url)) {
        setPaymentStatus('error');
        setErrorMessage('Payment was cancelled.');
        if (paymentKind === PAYMENT_KINDS.SAVINGS_AUTH) {
          scheduleDelayedNavigation(() => {
            router.replace((returnTo || '/wallet/savings/start') as Href);
          });
        }
      }
    },
    handleRetry: () => {
      if (paymentMethod === 'uba_redvault') {
        if (
          refs.statusRef.current === 'processing' ||
          refs.statusRef.current === 'success'
        )
          return;
        refs.paymentCompletionStartedRef.current = false;
        setErrorMessage(null);
        beginPaymentCompletion();
        return;
      }
      refs.vtuConfirmationTokenRef.current += 1;
      refs.savingsAuthorizationAbortRef.current?.abort();
      refs.savingsAuthorizationAbortRef.current = null;
      refs.paymentCompletionStartedRef.current = false;
      refs.copiedGatewayTextRef.current = null;
      clearPendingNavigation();
      clearPendingLoadTimeout();
      setPaymentStatus('loading');
      setErrorMessage(null);
      refs.webViewRef.current?.reload();
    },
    handleShouldStartLoadWithRequest: (request: { url: string }) => {
      if (
        (paymentMethod === 'uba_redvault' ||
          paymentKind === PAYMENT_KINDS.VTU ||
          paymentKind === PAYMENT_KINDS.WALLET ||
          paymentKind === PAYMENT_KINDS.SAVINGS_AUTH) &&
        isPaymentCompletionRedirect(request.url)
      ) {
        if (
          refs.statusRef.current === 'processing' ||
          refs.statusRef.current === 'success'
        ) {
          return false;
        }
        beginPaymentCompletion();
        return false;
      }
      return true;
    },
    handleWebViewError: (syntheticEvent: WebViewErrorEvent) => {
      const { nativeEvent } = syntheticEvent;
      if (
        refs.paymentCompletionStartedRef.current ||
        nativeEvent.url?.startsWith('about:')
      ) {
        return;
      }
      clearPendingLoadTimeout();
      setPaymentStatus('error');
      setErrorMessage(nativeEvent.description || 'Failed to load payment page');
    },
  };
}
