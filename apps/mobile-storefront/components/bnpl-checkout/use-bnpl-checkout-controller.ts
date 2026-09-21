import { useEffect, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import { trackCheckoutPaymentFailed } from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import {
  buildBNPLCheckoutUrl,
  getBNPLGatewayName,
  parseBNPLParams,
} from './bnpl-checkout.helpers';
import { createBNPLCheckoutAppNavigation } from './bnpl-checkout-app-navigation';
import { shouldHandleBNPLNavigationMessage } from './bnpl-checkout-controller-actions';
import {
  type BNPLWebViewMessageEvent,
  createBNPLWebViewMessageHandler,
} from './bnpl-checkout-message-handler';
import { createBNPLNavigationHandlers } from './bnpl-checkout-navigation-handlers';
import { createBNPLProviderBridgeHandlers } from './bnpl-checkout-provider-bridge';
import { createBNPLLoadTimers } from './bnpl-checkout-timers';
import { createBNPLWebViewErrorHandlers } from './bnpl-checkout-webview-error-handlers';
import { createBNPLLoadHandlers } from './bnpl-load-handlers';
import { createBNPLOpenWindowHandler } from './bnpl-open-window-handler';

type BNPLCheckoutParams = Parameters<typeof parseBNPLParams>[0];
export type BNPLCheckoutStatus = 'loading' | 'ready' | 'success' | 'error';
export type BNPLSetCheckoutStatus = (
  nextStatus:
    | BNPLCheckoutStatus
    | ((currentStatus: BNPLCheckoutStatus) => BNPLCheckoutStatus)
) => void;
export type BNPLRecordCheckoutFailure = (
  reason: 'bnpl_provider_error' | 'bnpl_load_error'
) => void;
type BNPLCheckoutControllerInput = {
  apiBaseUrl: string;
  merchantDomain?: string;
  params: BNPLCheckoutParams;
};
export function useBNPLCheckoutController({
  apiBaseUrl,
  merchantDomain,
  params,
}: BNPLCheckoutControllerInput) {
  const webViewRef = useRef<WebView>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCart = useCartStore((state) => state.clearCart);
  const appNavigationRef = useRef<ReturnType<
    typeof createBNPLCheckoutAppNavigation
  > | null>(null);
  const getAppNavigation = () => {
    if (appNavigationRef.current === null) {
      appNavigationRef.current = createBNPLCheckoutAppNavigation();
    }
    return appNavigationRef.current;
  };
  const validatedParams = parseBNPLParams(params);
  const {
    orderId,
    gateway,
    amount,
    orderTotal,
    trackingToken,
    merchantSlug,
    customerEmail,
    customerPhone,
    subtotal,
    shipping,
    tax,
  } = validatedParams.data || {};
  const bnplUrl = buildBNPLCheckoutUrl({
    apiBaseUrl,
    params: validatedParams,
  });
  const [status, setStatusState] = useState<BNPLCheckoutStatus>('loading');
  const [currentUrl, setCurrentUrl] = useState(bnplUrl);
  const [prevBnplUrl, setPrevBnplUrl] = useState(bnplUrl);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasReturnedToAppRef = useRef(false);
  // Attempt-scoped failure marker: duplicate provider error redirects and
  // late load-error callbacks for the same attempt must emit a single
  // payment_failed. A ref (not state) so the guard holds synchronously
  // across rerenders; reset only by Retry.
  const failureRecordedRef = useRef(false);
  const recordCheckoutFailure: BNPLRecordCheckoutFailure = (reason) => {
    if (failureRecordedRef.current) {
      return;
    }
    failureRecordedRef.current = true;
    void trackCheckoutPaymentFailed(reason, orderId, gateway);
  };
  const statusRef = useRef<BNPLCheckoutStatus>('loading');
  const documentUrlRef = useRef(bnplUrl);
  const trackDocumentUrl = (url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return;
    }
    documentUrlRef.current = url;
  };
  // The start is recorded only once the launcher confirms the provider
  // flow opened: initialization failures before that point (order lookup,
  // SDK load, popup creation) must not count as a start. A ref (not state)
  // so duplicate opened signals cannot double-emit.
  const paymentStartRecordedRef = useRef(false);
  if (bnplUrl !== prevBnplUrl) {
    setPrevBnplUrl(bnplUrl);
    if (bnplUrl) {
      setCurrentUrl(bnplUrl);
    }
  }
  const setCheckoutStatus: BNPLSetCheckoutStatus = (nextStatus) => {
    const resolvedStatus =
      typeof nextStatus === 'function'
        ? nextStatus(statusRef.current)
        : nextStatus;
    statusRef.current = resolvedStatus;
    setStatusState(resolvedStatus);
  };
  const getLoadTimers = () =>
    createBNPLLoadTimers({
      loadTimeoutRef,
      setCheckoutStatus,
      setErrorMessage,
      statusRef,
    });
  const clearPendingLoadTimeout = () =>
    getLoadTimers().clearPendingLoadTimeout();
  const scheduleLoadTimeout = () => getLoadTimers().scheduleLoadTimeout();
  useEffect(
    () => () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      appNavigationRef.current?.cancelOrderSuccessNavigation();
    },
    []
  );
  const returnToAppFromProviderExit = () => {
    if (hasReturnedToAppRef.current || statusRef.current === 'success') {
      return;
    }
    hasReturnedToAppRef.current = true;
    clearPendingLoadTimeout();
    setErrorMessage(null);
    setCheckoutStatus('ready');
    getAppNavigation().returnToApp();
  };

  const { handleNavigationChange, handleNavigationUrl } =
    createBNPLNavigationHandlers({
      amount,
      apiBaseUrl,
      clearCart,
      clearPendingLoadTimeout,
      customerEmail,
      customerPhone,
      gateway,
      merchantDomain,
      merchantSlug,
      orderId,
      orderTotal,
      recordCheckoutFailure,
      returnToAppFromProviderExit,
      scheduleOrderSuccess: (scheduleParams) =>
        getAppNavigation().scheduleOrderSuccess(scheduleParams),
      setCheckoutStatus,
      setErrorMessage,
      shipping,
      statusRef,
      subtotal,
      tax,
      trackDocumentUrl,
      trackingToken,
    });

  const handleClose = () =>
    getAppNavigation().showCancelAlert(returnToAppFromProviderExit);

  const { handleProviderErrorMessage, handleProviderOpenedMessage } =
    createBNPLProviderBridgeHandlers({
      amount,
      clearPendingLoadTimeout,
      gateway,
      orderId,
      paymentStartRecordedRef,
      recordCheckoutFailure,
      setCheckoutStatus,
      setErrorMessage,
      statusRef,
    });

  const handleWebViewMessage = (event: BNPLWebViewMessageEvent) =>
    createBNPLWebViewMessageHandler({
      onCloseMessage: returnToAppFromProviderExit,
      onProviderErrorMessage: handleProviderErrorMessage,
      onProviderOpenedMessage: handleProviderOpenedMessage,
      onNavigationMessage: (url) => {
        if (
          !shouldHandleBNPLNavigationMessage({
            apiBaseUrl,
            merchantDomain,
            merchantSlug,
            url,
          })
        ) {
          return;
        }

        handleNavigationUrl(url);
      },
    })(event);

  const handleRetry = () => {
    clearPendingLoadTimeout();
    failureRecordedRef.current = false;
    // A new attempt must emit its own payment_started: without this reset
    // a retried provider flow that opens and fails again produces an
    // unmatched payment_failed and corrupts retry funnel measurements.
    paymentStartRecordedRef.current = false;
    setCheckoutStatus('loading');
    setErrorMessage(null);
    setCurrentUrl(bnplUrl);
    const shouldReloadCurrentCheckout =
      Boolean(bnplUrl) && currentUrl === bnplUrl;
    if (shouldReloadCurrentCheckout) {
      webViewRef.current?.reload();
    }
  };

  const { handleLoadEnd, handleLoadStart } = createBNPLLoadHandlers({
    clearPendingLoadTimeout,
    scheduleLoadTimeout,
    setCheckoutStatus,
    setErrorMessage,
    statusRef,
  });

  const handleOpenWindow = createBNPLOpenWindowHandler({
    apiBaseUrl,
    merchantDomain,
    merchantSlug,
    clearPendingLoadTimeout,
    scheduleLoadTimeout,
    setCheckoutStatus,
    setCurrentUrl,
    setErrorMessage,
  });

  const {
    handleShouldStartLoadWithRequest,
    handleWebViewError,
    handleWebViewHttpError,
  } = createBNPLWebViewErrorHandlers({
    apiBaseUrl,
    bnplUrl,
    clearPendingLoadTimeout,
    currentUrl,
    documentUrlRef,
    merchantDomain,
    merchantSlug,
    paymentStartRecordedRef,
    recordCheckoutFailure,
    returnToAppFromProviderExit,
    scheduleLoadTimeout,
    setCheckoutStatus,
    setCurrentUrl,
    setErrorMessage,
    statusRef,
    trackDocumentUrl,
  });

  return {
    amount,
    bnplUrl,
    currentUrl,
    errorMessage,
    gatewayName: getBNPLGatewayName(gateway),
    handleClose,
    handleLoadEnd,
    handleLoadStart,
    handleNavigationChange,
    handleOpenWindow,
    handleRetry,
    handleShouldStartLoadWithRequest,
    handleWebViewError,
    handleWebViewHttpError,
    handleWebViewMessage,
    status,
    validatedParams,
    webViewRef,
  };
}
