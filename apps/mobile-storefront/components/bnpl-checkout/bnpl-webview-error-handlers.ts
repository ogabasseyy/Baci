import type {
  BNPLWebViewHttpErrorEvent,
  BNPLWebViewLoadError,
} from './BNPLCheckoutWebView';
import { logBNPLCheckoutDebug } from './bnpl-checkout-message-handler';

export function handleBNPLWebViewError(
  error: BNPLWebViewLoadError,
  clearPendingLoadTimeout: () => void,
  setCheckoutStatus: (status: 'error') => void,
  setErrorMessage: (message: string) => void
): void {
  logBNPLCheckoutDebug('native load error', error);
  clearPendingLoadTimeout();
  setCheckoutStatus('error');
  setErrorMessage(error.description || 'Failed to load payment page');
}

export function handleBNPLWebViewHttpError(
  event: BNPLWebViewHttpErrorEvent
): void {
  const { description, statusCode, url } = event.nativeEvent;
  logBNPLCheckoutDebug('http error', { description, statusCode, url });
}
