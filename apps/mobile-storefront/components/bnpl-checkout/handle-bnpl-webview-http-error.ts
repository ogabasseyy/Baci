import type { BNPLWebViewHttpErrorEvent } from './BNPLCheckoutWebView';
import { logBNPLCheckoutDebug } from './bnpl-checkout-message-handler';

// Main-document HTTP failures (4xx/5xx on the loaded checkout document)
// leave the shopper on an unusable provider error page: the caller must
// transition those to the error state (which surfaces retry UI) and record
// the attempt-scoped failure. Subresource failures (images, XHR, iframes
// on other URLs) only get debug-logged — they must not fail a usable
// checkout. The native event carries no frame flag, so the main document
// is identified by URL equality with the tracked document URL.
export function isMainDocumentHttpError(
  eventUrl: string | undefined,
  documentUrl: string | undefined
): boolean {
  if (!eventUrl || !documentUrl) {
    return false;
  }
  return eventUrl.replace(/\/+$/, '') === documentUrl.replace(/\/+$/, '');
}

export function handleBNPLWebViewHttpError(
  event: BNPLWebViewHttpErrorEvent,
  options?: {
    documentUrl?: string;
    onMainDocumentError?: (message: string) => void;
  }
): void {
  const { description, statusCode, url } = event.nativeEvent;
  logBNPLCheckoutDebug('http error', { description, statusCode, url });
  if (
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    isMainDocumentHttpError(url, options?.documentUrl)
  ) {
    options?.onMainDocumentError?.(
      description || `The payment page failed to load (HTTP ${statusCode})`
    );
  }
}
