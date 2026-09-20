import { useEffect, useRef, useState } from 'react';
import type { WebView, WebViewNavigation } from 'react-native-webview';
import {
  trackCheckoutPaymentCompletedOnce,
  trackCheckoutPaymentFailed,
  trackCheckoutPaymentStarted,
} from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import type {
  BNPLShouldStartLoadRequest,
  BNPLWebViewHttpErrorEvent,
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
  // Main-document URL for HTTP-error classification. A ref (not the
  // currentUrl state, which feeds the WebView source and must not be
  // rewritten here): allowed top-frame navigations return true without
  // touching state, and server redirects never reach should-start-load —
  // without this tracking a provider/identity document that 404s/500s is
  // misclassified as a subresource failure and load-end marks it ready.
  const documentUrlRef = useRef(bnplUrl);
  const trackDocumentUrl = (url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return;
    }
    documentUrlRef.current = url;
  };
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
        // The approved completion consumes the durable claim immediately:
        // forward the routed guest identity and breakdown snapshot, since
        // success-screen polling cannot enrich the claim afterwards.
        await trackCheckoutPaymentCompletedOnce({
          ...(customerEmail && { customerEmail }),
          ...(customerPhone && { customerPhone }),
          orderId,
          paymentMethod: gateway || 'bnpl',
          reference: effect.reference || undefined,
          ...(shipping !== undefined && { shipping: Number(shipping) }),
          ...(subtotal !== undefined && { subtotal: Number(subtotal) }),
          ...(tax !== undefined && { tax: Number(tax) }),
          // Revenue is the canonical order total, not the residual the
          // provider charged after wallet/savings credit. This immediate
          // path wins the durable claim, so understating here cannot be
          // repaired by the later tracked-order poll. Older routes without
          // orderTotal keep the charged amount.
          value: orderTotal
            ? Number(orderTotal)
            : amount
              ? Number(amount)
              : undefined,
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
    // broken BNPL attempts are distinguishable from abandonment. Late
    // callbacks arriving after success (e.g. an aborted-load error while
    // the success navigation is replaced) must not flip a paid checkout
    // back to error or double-emit failure beside the completion.
    if (statusRef.current === 'success') {
      return;
    }
    recordCheckoutFailure('bnpl_provider_error');
    setCheckoutStatus(effect.status);
    setErrorMessage(effect.errorMessage);
  };

  const handleNavigationChange = (navState: WebViewNavigation) => {
    // navState.url is always the top-level document (server redirects
    // never reach should-start-load), so it is the freshest main-document
    // signal for HTTP-error classification.
    trackDocumentUrl(navState.url);
    return handleNavigationUrl(navState.url);
  };

  const handleClose = () =>
    getAppNavigation().showCancelAlert(returnToAppFromProviderExit);

  // The start is recorded only once the launcher confirms the provider
  // flow opened: initialization failures before that point (order lookup,
  // SDK load, popup creation) must not count as a start. A ref (not state)
  // so duplicate opened signals cannot double-emit.
  const paymentStartRecordedRef = useRef(false);
  const handleProviderOpenedMessage = ({
    gateway: openedGateway,
    orderId: openedOrderId,
  }: {
    gateway?: string;
    orderId?: string;
  }) => {
    if (paymentStartRecordedRef.current || !orderId) {
      return;
    }
    if (openedGateway && gateway && openedGateway !== gateway) {
      return;
    }
    if (openedOrderId && openedOrderId !== orderId) {
      return;
    }
    paymentStartRecordedRef.current = true;
    void trackCheckoutPaymentStarted({
      orderId,
      paymentMethod: gateway || 'bnpl',
      value: amount ? Number(amount) : undefined,
    });
  };
  // Attempt-scoped failure bridged from the web launcher when an opened
  // provider's SDK fails (decline or runtime error): without this the
  // native funnel keeps the start from bnpl_provider_opened with no
  // matching failure. Late callbacks after success are ignored, like
  // provider error redirects.
  const handleProviderErrorMessage = ({
    gateway: errorGateway,
    orderId: errorOrderId,
    message,
  }: {
    gateway?: string;
    orderId?: string;
    message?: string;
  }) => {
    if (statusRef.current === 'success') {
      return;
    }
    if (errorGateway && gateway && errorGateway !== gateway) {
      return;
    }
    if (errorOrderId && errorOrderId !== orderId) {
      return;
    }
    recordCheckoutFailure('bnpl_provider_error');
    clearPendingLoadTimeout();
    setCheckoutStatus('error');
    setErrorMessage(message || 'The provider checkout failed.');
  };

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
      // An accepted top-frame navigation becomes the document: a later
      // HTTP error on this URL is a main-document failure. Subresource
      // (non-top-frame) and blank/popup URLs are never tracked.
      if (request.isTopFrame !== false) {
        trackDocumentUrl(request.url);
      }
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
    // Ignore callbacks once the attempt has succeeded (see above).
    if (statusRef.current === 'success') {
      return;
    }
    recordCheckoutFailure('bnpl_load_error');
    handleBNPLWebViewError(
      error,
      clearPendingLoadTimeout,
      () => setCheckoutStatus('error'),
      setErrorMessage
    );
  };

  const handleWebViewHttpError = (event: BNPLWebViewHttpErrorEvent) => {
    // Late callbacks arriving after success must not flip a paid checkout
    // back to error (same guard as load errors above).
    if (statusRef.current === 'success') {
      return;
    }
    // A 4xx/5xx on the tracked document means the launch page itself is
    // an unusable provider error page: transition to error (surfacing
    // retry UI) and record the attempt-scoped failure instead of letting
    // a later load-end mark the checkout ready. Subresource failures only
    // log inside the handler.
    handleBNPLWebViewHttpError(event, {
      documentUrl: documentUrlRef.current || currentUrl || bnplUrl,
      onMainDocumentError: (message) => {
        recordCheckoutFailure('bnpl_load_error');
        clearPendingLoadTimeout();
        setCheckoutStatus('error');
        setErrorMessage(message);
      },
    });
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
