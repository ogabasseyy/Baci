import { type Href, router } from 'expo-router';
import type { WebViewNavigation } from 'react-native-webview';
import { trackCheckoutPaymentFailed } from '@/services/analytics';
import {
  isPaymentCancellationRedirect,
  isSessionPaymentCompletionRedirect,
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
  gateway?: string;
  orderId?: string;
  paymentKind?: string;
  reference?: string;
  refs: PaymentGatewayRefs;
  returnTo?: string;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  scheduleLoadTimeout: () => void;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
}

const terminalStatuses = new Set(['error', 'processing', 'success']);

export function createPaymentGatewayEventHandlers({
  beginPaymentCompletion,
  clearPendingLoadTimeout,
  clearPendingNavigation,
  gateway,
  orderId,
  paymentKind,
  reference,
  refs,
  returnTo,
  scheduleDelayedNavigation,
  scheduleLoadTimeout,
  setErrorMessage,
  setPaymentStatus,
}: PaymentGatewayEventHandlerInput) {
  const isTerminalStatus = () => terminalStatuses.has(refs.statusRef.current);

  // Attempt-scoped failure marker: duplicate provider callbacks for the
  // same failed attempt must not inflate terminal failures. The marker
  // lives in a controller ref (not a factory local) because the controller
  // recreates this factory on every render — e.g. after the first failure
  // sets status to error — and a local would reset, letting a late
  // duplicate callback emit payment_failed again. Set synchronously on
  // first emission (status refs only mirror on render), stamped with the
  // failed reference, and reset only by Retry for a new reference.
  const recordPaymentFailure = (reason: string) => {
    // VTU, wallet, and savings-auth flows share this controller but have no
    // checkout order or matching checkout start: their failures must not
    // pollute the commerce funnel.
    if (paymentKind !== PAYMENT_KINDS.ORDER) {
      return;
    }
    if (refs.paymentFailureRecordedRef.current) {
      return;
    }
    refs.paymentFailureRecordedRef.current = true;
    refs.paymentFailureReferenceRef.current = reference;
    // Stamped with the attempt reference so failures reconcile against
    // their provider-issued start instead of merging across retries.
    void trackCheckoutPaymentFailed(reason, orderId, gateway, reference);
  };

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
      // Require the redirect to carry this session's provider reference when
      // it carries one at all: an unrelated URL with a foreign trxref must
      // not report success.
      if (isSessionPaymentCompletionRedirect(navState.url, reference)) {
        beginPaymentCompletion();
        return;
      }
      if (isPaymentCancellationRedirect(navState.url)) {
        setPaymentStatus('error');
        setErrorMessage('Payment was cancelled.');
        // A cancelled provider page is a terminal failure, not abandonment.
        recordPaymentFailure('payment_gateway_cancelled');
        if (paymentKind === PAYMENT_KINDS.SAVINGS_AUTH) {
          scheduleDelayedNavigation(() => {
            router.replace((returnTo || '/wallet/savings/start') as Href);
          });
        }
      }
    },
    handleRetry: () => {
      // Retry reloads the same authorization URL and reference without a
      // new checkout start: retain the failure marker so repeated reload
      // failures emit a single payment_failed for the one started attempt.
      // Only a new reference (a genuinely new attempt) may reset it.
      if (refs.paymentFailureReferenceRef.current !== reference) {
        refs.paymentFailureRecordedRef.current = false;
        refs.paymentFailureReferenceRef.current = reference;
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
        (paymentKind === PAYMENT_KINDS.VTU ||
          paymentKind === PAYMENT_KINDS.WALLET ||
          paymentKind === PAYMENT_KINDS.SAVINGS_AUTH) &&
        isSessionPaymentCompletionRedirect(request.url, reference)
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
      // A broken provider page is a terminal failure, not abandonment.
      recordPaymentFailure('payment_gateway_load_error');
    },
  };
}
