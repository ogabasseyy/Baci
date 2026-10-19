import type { CheckoutFunnelEventName } from '@baci/shared/contracts';
import { captureClientEvent } from './capture-client-event';

const capturedCheckoutEvents = new Set<string>();

/**
 * Confirmation pages can be revisited or refreshed. Keep conversion events
 * once per browser session and order so a refresh cannot inflate payment
 * completion or invoice-generation counts.
 */
export function captureCheckoutFunnelEventOnce(
  event: CheckoutFunnelEventName,
  orderId: string | undefined,
  properties: Record<string, unknown>
): void {
  const eventKey = orderId ? `${event}:${orderId}` : null;
  if (eventKey && capturedCheckoutEvents.has(eventKey)) {
    return;
  }

  if (eventKey && typeof window !== 'undefined') {
    try {
      if (window.sessionStorage.getItem(`baci:${eventKey}`)) {
        capturedCheckoutEvents.add(eventKey);
        return;
      }
      window.sessionStorage.setItem(`baci:${eventKey}`, '1');
    } catch {
      // Session storage can be unavailable in privacy modes; memory dedupe
      // still protects repeated renders within the current page.
    }
  }

  if (eventKey) {
    capturedCheckoutEvents.add(eventKey);
  }
  captureClientEvent(event, properties);
}
