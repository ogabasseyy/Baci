/**
 * Non-HttpOnly tri-state hint cookie (`'1'` | `'0'`), namespaced by
 * merchant id so cold anonymous visitors skip eager cart hydration
 * without leaking state across stores on the same origin.
 */
export function cartSessionHintCookieName(merchantIdentifier: string): string {
  return `baci-cart-hint-${merchantIdentifier.trim().toLowerCase()}`;
}
