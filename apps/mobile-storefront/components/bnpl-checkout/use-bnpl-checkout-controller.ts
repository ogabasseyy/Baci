import { useEffect, useRef, useState } from 'react';
import type { WebView, WebViewNavigation } from 'react-native-webview';
import { useCartStore } from '@/stores/cart-store';
import type {
  BNPLShouldStartLoadRequest,
  BNPLWebViewHttpErrorEvent,
  BNPLWebViewLoadError,
} from './BNPLCheckoutWebView';
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
import { createBNPLOpenWindowHandler } from './bnpl-open-window-handler';

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

    setCheckoutStatus(effect.status);
    if (effect.status === 'success') {
      await clearCart();
      getAppNavigation().scheduleOrderSuccess({
        gateway,
        orderId,
        reference: effect.reference,
        trackingToken,
      });
      return;
    }
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
    setCheckoutStatus('loading');
    setErrorMessage(null);
    setCurrentUrl(bnplUrl);
    const shouldReloadCurrentCheckout =
      Boolean(bnplUrl) && currentUrl === bnplUrl;
    if (shouldReloadCurrentCheckout) {
      webViewRef.current?.reload();
    }
  };

  const handleLoadStart = () => {
    if (statusRef.current === 'error' || statusRef.current === 'success') {
      return;
    }
    setErrorMessage(null);
    scheduleLoadTimeout();
    setCheckoutStatus('loading');
  };

  const handleLoadEnd = () => {
    clearPendingLoadTimeout();
    setCheckoutStatus((currentStatus) =>
      currentStatus === 'error' || currentStatus === 'success'
        ? currentStatus
        : 'ready'
    );
  };

  // Pure factory returning the event handler — no render side effects.
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

  const handleWebViewError = (error: BNPLWebViewLoadError) => {
    logBNPLCheckoutDebug('native load error', error);
    clearPendingLoadTimeout();
    setCheckoutStatus('error');
    setErrorMessage(error.description || 'Failed to load payment page');
  };

  const handleWebViewHttpError = (event: BNPLWebViewHttpErrorEvent) => {
    const { description, statusCode, url } = event.nativeEvent;
    logBNPLCheckoutDebug('http error', { description, statusCode, url });
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
    handleWebViewHttpError,
    handleWebViewMessage,
    status,
    validatedParams,
    webViewRef,
  };
}
