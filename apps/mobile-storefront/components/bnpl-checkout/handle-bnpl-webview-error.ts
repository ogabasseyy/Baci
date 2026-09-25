import type { BNPLWebViewLoadError } from './BNPLCheckoutWebView';
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
