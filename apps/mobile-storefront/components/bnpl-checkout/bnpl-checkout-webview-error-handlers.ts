import type { MutableRefObject } from 'react';
import type {
  BNPLShouldStartLoadRequest,
  BNPLWebViewHttpErrorEvent,
} from './BNPLCheckoutWebView';
import {
  BNPL_UNTRUSTED_POPUP_MESSAGE,
  resolveBNPLDocumentNavigation,
} from './bnpl-checkout.helpers';
import { logBNPLCheckoutDebug } from './bnpl-checkout-message-handler';
import { handleBNPLWebViewError } from './handle-bnpl-webview-error';
import { handleBNPLWebViewHttpError } from './handle-bnpl-webview-http-error';
import type {
  BNPLCheckoutStatus,
  BNPLRecordCheckoutFailure,
  BNPLSetCheckoutStatus,
} from './use-bnpl-checkout-controller';

export interface BNPLWebViewErrorHandlerDeps {
  apiBaseUrl: string;
  merchantDomain?: string;
  merchantSlug?: string;
  bnplUrl: string;
  currentUrl: string;
  // Main-document URL for HTTP-error classification, owned by the caller
  // (a ref, not the currentUrl state which feeds the WebView source and
  // must not be rewritten here): allowed top-frame navigations return true
  // without touching state, and server redirects never reach
  // should-start-load — without this tracking a provider/identity document
  // that 404s/500s is misclassified as a subresource failure and load-end
  // marks it ready.
  documentUrlRef: MutableRefObject<string>;
  statusRef: MutableRefObject<BNPLCheckoutStatus>;
  paymentStartRecordedRef: MutableRefObject<boolean>;
  setCheckoutStatus: BNPLSetCheckoutStatus;
  setErrorMessage: (message: string | null) => void;
  setCurrentUrl: (url: string) => void;
  clearPendingLoadTimeout: () => void;
  scheduleLoadTimeout: () => void;
  recordCheckoutFailure: BNPLRecordCheckoutFailure;
  returnToAppFromProviderExit: () => void;
  trackDocumentUrl: (url: unknown) => void;
}

/**
 * Main-document navigation gating plus terminal load/HTTP-error handling
 * with the pre-open funnel guard. Owns the tracked document URL used for
 * HTTP-error classification. Extracted from
 * use-bnpl-checkout-controller (300-line file limit).
 */
export function createBNPLWebViewErrorHandlers({
  apiBaseUrl,
  merchantDomain,
  merchantSlug,
  bnplUrl,
  currentUrl,
  documentUrlRef,
  statusRef,
  paymentStartRecordedRef,
  setCheckoutStatus,
  setErrorMessage,
  setCurrentUrl,
  clearPendingLoadTimeout,
  scheduleLoadTimeout,
  recordCheckoutFailure,
  returnToAppFromProviderExit,
  trackDocumentUrl,
}: BNPLWebViewErrorHandlerDeps) {
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
    // Pre-open load failures (offline/DNS before the provider opens) keep
    // the error UI below but must not emit a funnel failure: with no
    // payment_started to match, that would be an unmatched pre-payment
    // failure. The attempt-scoped marker stays clear so a later
    // post-open failure still records.
    if (paymentStartRecordedRef.current) {
      recordCheckoutFailure('bnpl_load_error');
    }
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
        // Same pre-open guard as load errors: error UI always, funnel
        // failure only with a matching payment_started.
        if (paymentStartRecordedRef.current) {
          recordCheckoutFailure('bnpl_load_error');
        }
        clearPendingLoadTimeout();
        setCheckoutStatus('error');
        setErrorMessage(message);
      },
    });
  };

  return {
    handleShouldStartLoadWithRequest,
    handleWebViewError,
    handleWebViewHttpError,
  };
}
