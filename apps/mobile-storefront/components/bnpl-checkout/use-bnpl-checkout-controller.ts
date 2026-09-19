import { useEffect, useRef, useState } from 'react';
import type { WebView, WebViewNavigation } from 'react-native-webview';
import {
  trackCheckoutPaymentCompletedOnce,
  trackCheckoutPaymentFailed,
} from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import type { BNPLShouldStartLoadRequest } from './BNPLCheckoutWebView';
import {
  BNPL_UNTRUSTED_POPUP_MESSAGE,
  buildBNPLCheckoutUrl,
  getBNPLGatewayName,
  parseBNPLParams,
  resolveBNPLDocumentNavigation,
} from './bnpl-checkout.helpers';
import { createBNPLCheckoutAppNavigation } from './bnpl-checkout-app-navigation';
import {
  resolveBNPLNavigationUrlEffect,
  shouldHandleBNPLNavigationMessage,
} from './bnpl-checkout-controller-actions';
import {
  type BNPLWebViewMessageEvent,
  createBNPLWebViewMessageHandler,
  logBNPLCheckoutDebug,
} from './bnpl-checkout-message-handler';
import { createBNPLLoadTimers } from './bnpl-checkout-timers';
import { createBNPLLoadHandlers } from './bnpl-load-handlers';
import { createBNPLOpenWindowHandler } from './bnpl-open-window-handler';
import { handleBNPLWebViewError } from './handle-bnpl-webview-error';
import { handleBNPLWebViewHttpError } from './handle-bnpl-webview-http-error';

type BNPLCheckoutParams = Parameters<typeof parseBNPLParams>[0];
export type BNPLCheckoutStatus = 'loading' | 'ready' | 'success' | 'error';
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
  const { orderId, gateway, amount, trackingToken, merchantSlug } =
    validatedParams.data || {};
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
  const recordCheckoutFailure = (
    reason: 'bnpl_provider_error' | 'bnpl_load_error'
  ) => {
    if (failureRecordedRef.current) {
      return;
    }
    failureRecordedRef.current = true;
    trackCheckoutPaymentFailed(reason, orderId, gateway);
  };
  const statusRef = useRef<BNPLCheckoutStatus>('loading');
  if (bnplUrl !== prevBnplUrl) {
    setPrevBnplUrl(bnplUrl);
    if (bnplUrl) {
      setCurrentUrl(bnplUrl);
    }
  }
  const setCheckoutStatus = (
    nextStatus:
      | BNPLCheckoutStatus
      | ((currentStatus: BNPLCheckoutStatus) => BNPLCheckoutStatus)
  ) => {
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
  const handleNavigationUrl = async (url: string) => {
    const effect = resolveBNPLNavigationUrlEffect(url, {
      apiBaseUrl,
      gateway,
      merchantDomain,
      merchantSlug,
    });
    if (!effect) {
      return;
    }

    clearPendingLoadTimeout();
    if (effect.status === 'return-to-app') {
      returnToAppFromProviderExit();
      return;
    }

    if (effect.status === 'success') {
      if (statusRef.current === 'success') {
        return;
      }
      setCheckoutStatus('success');
      // Accepted-but-pending provider results still reach the success
      // experience below, but are not paid conversions: skip attribution.
      if (orderId && !effect.isPending) {
        await trackCheckoutPaymentCompletedOnce({
          orderId,
          paymentMethod: gateway || 'bnpl',
          reference: effect.reference || undefined,
          value: amount ? Number(amount) : undefined,
        });
      }
      await clearCart();
      getAppNavigation().scheduleOrderSuccess({
        gateway,
        orderId,
        reference: effect.reference,
        trackingToken,
      });
      return;
    }
    // Terminal provider error redirect: capture the failure so declined or
    // broken BNPL attempts are distinguishable from abandonment.
    recordCheckoutFailure('bnpl_provider_error');
    setCheckoutStatus(effect.status);
    setErrorMessage(effect.errorMessage);
  };

  const handleNavigationChange = (navState: WebViewNavigation) =>
    handleNavigationUrl(navState.url);

  const handleClose = () =>
    getAppNavigation().showCancelAlert(returnToAppFromProviderExit);

  const handleWebViewMessage = (event: BNPLWebViewMessageEvent) =>
    createBNPLWebViewMessageHandler({
      onCloseMessage: returnToAppFromProviderExit,
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

  const handleShouldStartLoadWithRequest = (
    request: BNPLShouldStartLoadRequest
  ) => {
    const currentDocumentUrl = currentUrl || bnplUrl;
    const decision = resolveBNPLDocumentNavigation({
      apiBaseUrl,
      currentDocumentUrl,
      isTopFrame: request.isTopFrame,
      requestUrl: request.url,
      merchantDomain,
      merchantSlug,
    });
    logBNPLCheckoutDebug('document navigation decision', {
      currentDocumentUrl,
      decision,
      isTopFrame: request.isTopFrame,
      mainDocumentURL: request.mainDocumentURL,
      merchantDomain,
      merchantSlug,
      navigationType: request.navigationType,
      requestUrl: request.url,
    });
    if (decision.shouldStart) {
      return true;
    }

    if (decision.reason === 'untrusted') {
      clearPendingLoadTimeout();
      setCheckoutStatus('error');
      setErrorMessage(BNPL_UNTRUSTED_POPUP_MESSAGE);
      return false;
    }

    if (decision.reason === 'return-to-app') {
      returnToAppFromProviderExit();
      return false;
    }

    setErrorMessage(null);
    scheduleLoadTimeout();
    setCheckoutStatus('loading');
    setCurrentUrl(decision.nextUrl);
    return false;
  };

  const handleWebViewError = (
    error: Parameters<typeof handleBNPLWebViewError>[0]
  ) => {
    // Terminal WebView load failure: capture it like a provider error
    // redirect so broken BNPL attempts are not counted as abandonment.
    recordCheckoutFailure('bnpl_load_error');
    handleBNPLWebViewError(
      error,
      clearPendingLoadTimeout,
      () => setCheckoutStatus('error'),
      setErrorMessage
    );
  };

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
    handleWebViewHttpError: handleBNPLWebViewHttpError,
    handleWebViewMessage,
    status,
    validatedParams,
    webViewRef,
  };
}
