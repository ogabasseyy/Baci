import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from './pending-checkout-order';

/** Save before leaving for a gateway, without waiting for React or a debounce. */
export function persistPendingCheckoutOrder(
  snapshot: PendingCheckoutOrderSnapshot
): void {
  try {
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    throw new Error(
      'Unable to save your pending order. Please enable browser storage and retry payment.'
    );
  }
}
