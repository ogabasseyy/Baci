import type { BNPLWebViewHttpErrorEvent } from './BNPLCheckoutWebView';
import { logBNPLCheckoutDebug } from './bnpl-checkout-message-handler';

export function handleBNPLWebViewHttpError(
  event: BNPLWebViewHttpErrorEvent
): void {
  const { description, statusCode, url } = event.nativeEvent;
  logBNPLCheckoutDebug('http error', { description, statusCode, url });
}
