import type { ChatwootCheckoutCreatedOrder } from './chatwoot-checkout-order';
import type { ChatwootCheckoutBank } from './chatwoot-checkout-payment';

export interface ChatwootCheckoutIssuedPayment {
  bank: ChatwootCheckoutBank;
  reference: string;
}

export interface ChatwootCheckoutRememberedOrder {
  /** The merchant the order was created for; a replay must match it. */
  merchantId: string;
  order: ChatwootCheckoutCreatedOrder;
  /** Set once bank details were issued, so a replay returns them unchanged. */
  payment: ChatwootCheckoutIssuedPayment | null;
}

/**
 * Orders this page created through the chat, keyed by the derived idempotency
 * key. It lets a repeat of the same widget request id answer from memory even
 * though creating the order moved the cart version, and it is the only source
 * of payment references the chat may poll. It lasts for the page session; the
 * server idempotency key still protects a reload or a second tab.
 */
const remembered = new Map<string, ChatwootCheckoutRememberedOrder>();
const MAX_REMEMBERED_ORDERS = 20;

export function getChatwootCheckoutRememberedOrder(key: string) {
  return remembered.get(key) ?? null;
}

export function rememberChatwootCheckoutOrder(
  key: string,
  merchantId: string,
  order: ChatwootCheckoutCreatedOrder
) {
  remembered.set(key, { merchantId, order, payment: null });
  if (remembered.size > MAX_REMEMBERED_ORDERS) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
}

export function rememberChatwootCheckoutPayment(
  key: string,
  payment: ChatwootCheckoutIssuedPayment
) {
  const entry = remembered.get(key);
  if (entry) entry.payment = payment;
}

/**
 * True only for a payment reference issued for an order this page created
 * through the chat. Any other reference must not reach the status route: that
 * route is keyed by reference alone, so forwarding widget-supplied values
 * would let a chat session probe payments that are not its own.
 */
export function isChatwootCheckoutIssuedReference(reference: string) {
  for (const entry of remembered.values()) {
    if (entry.payment?.reference === reference) return true;
  }
  return false;
}

/** Test seam: forget remembered orders between cases. */
export function resetChatwootCheckoutOrderMemory() {
  remembered.clear();
}
