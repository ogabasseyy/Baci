import { chatwootCheckoutMemorySchema } from '@/schemas/chatwoot-checkout-memory';
import type { ChatwootCheckoutBank } from './chatwoot-checkout-payment';
import type { ChatwootCheckoutCreatedOrder } from './chatwoot-checkout-result';

export interface ChatwootCheckoutIssuedPayment {
  bank: ChatwootCheckoutBank;
  reference: string;
  /** When the bank details were issued (epoch ms); bounds how long a poll is meaningful. */
  issuedAt: number;
  /** Provider-reported expiry for temporary transfer accounts (epoch ms). */
  expiresAt?: number;
}

export interface ChatwootCheckoutRememberedOrder {
  /** The merchant the order was created for; a replay must match it. */
  merchantId: string;
  /** The chat conversation that placed the order; only it may replay or poll. */
  conversationId: number;
  /** The cart the order was placed from; a second attempt on it reuses the order. */
  cartId: string;
  order: ChatwootCheckoutCreatedOrder;
  /** Set once bank details were issued, so a replay returns them unchanged. */
  payment: ChatwootCheckoutIssuedPayment | null;
}

/**
 * Orders this tab created through the chat, keyed by the derived idempotency
 * key. It lets a repeat of the same widget request id answer without a second
 * order or a second set of bank details even though creating the order moved
 * the cart, and it is the only source of orders the chat may poll.
 *
 * It is mirrored to the tab's session storage so a page reload keeps it. It
 * holds what the shopper was already shown (order number, amount, bank
 * details) plus the order's tracking token; no contact or address details.
 * An order whose response never reached the page is not recoverable from
 * here: that needs a server recovery path.
 */
const remembered = new Map<string, ChatwootCheckoutRememberedOrder>();
const MAX_REMEMBERED_ORDERS = 20;
const STORAGE_KEY = 'baci-chat-checkout-orders:v1';
let hydrated = false;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = chatwootCheckoutMemorySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    for (const [key, entry] of parsed.data) remembered.set(key, entry);
  } catch {
    // Unreadable storage only costs reload recovery.
  }
}

function persist() {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify([...remembered]));
  } catch {
    // A full or blocked store only costs reload recovery.
  }
}

export function getChatwootCheckoutRememberedOrder(key: string) {
  hydrate();
  return remembered.get(key) ?? null;
}

export function rememberChatwootCheckoutOrder(
  key: string,
  owner: { merchantId: string; conversationId: number; cartId: string },
  order: ChatwootCheckoutCreatedOrder
) {
  hydrate();
  remembered.set(key, { ...owner, order, payment: null });
  if (remembered.size > MAX_REMEMBERED_ORDERS) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  persist();
}

export function rememberChatwootCheckoutPayment(
  key: string,
  payment: Omit<ChatwootCheckoutIssuedPayment, 'issuedAt'>
) {
  hydrate();
  const entry = remembered.get(key);
  if (!entry) return;
  entry.payment = { ...payment, issuedAt: Date.now() };
  persist();
}

/**
 * The order already placed from a cart, with the key it is remembered under.
 * A cart is completed by its order, so a later attempt on the same cart, even
 * under a new widget request id, can only mean that same order.
 */
export function findChatwootCheckoutOrderForCart(cartId: string) {
  hydrate();
  for (const [key, entry] of remembered) {
    if (entry.cartId === cartId) return { key, entry };
  }
  return null;
}

/** The remembered order a payment reference was issued for, if any. */
export function getChatwootCheckoutRememberedOrderByReference(
  reference: string
) {
  hydrate();
  for (const entry of remembered.values()) {
    if (entry.payment?.reference === reference) return entry;
  }
  return null;
}

/**
 * True only for a payment reference issued for an order this page created
 * through the chat. Any other reference must not reach the status route: that
 * route is keyed by reference alone, so forwarding widget-supplied values
 * would let a chat session probe payments that are not its own.
 */
export function isChatwootCheckoutIssuedReference(reference: string) {
  return getChatwootCheckoutRememberedOrderByReference(reference) !== null;
}

/** Test seam: forget remembered orders between cases. */
export function resetChatwootCheckoutOrderMemory() {
  remembered.clear();
  hydrated = false;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Test seam: drop the in-memory copy only, as a page reload does. */
export function simulateChatwootCheckoutReload() {
  remembered.clear();
  hydrated = false;
}
