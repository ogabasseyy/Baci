import type { CartItem } from '@/stores/cart-store.types';
import type { NativeSharedCartRef } from './controller-options';
import type { PendingCartRequest } from './pending-request';

interface LegacyCartView {
  items: CartItem[];
  sharedCartRef?: NativeSharedCartRef;
}

/**
 * A pending promotion (create, handoff redemption, or account link)
 * whose bootstrap authority has expired can never be recovered: its
 * actor check will fail forever, so its receipt is retired instead of
 * stranding every refresh and write.
 */
export function isUnrecoverablePromotion(
  pending: PendingCartRequest | null
): boolean {
  const body = pending?.body;
  return Boolean(
    body &&
      typeof body === 'object' &&
      'kind' in body &&
      (body.kind === 'create' ||
        body.kind === 'handoff' ||
        body.kind === 'account')
  );
}

/**
 * Retire the published reference to a finished cart as part of starting
 * the next generation; otherwise it would trip the reconnect guard
 * forever. The items survive for the fresh cart's lines. Only the exact
 * terminal cart is retired — a live different-cart reference is left
 * untouched so the caller still surfaces `reconnect_required`.
 */
export function retireTerminalReference(
  legacy: LegacyCartView,
  terminalCartId: string | null,
  repairLegacy?: (items: CartItem[]) => void
): LegacyCartView {
  if (
    !legacy.sharedCartRef ||
    !terminalCartId ||
    legacy.sharedCartRef.cartId !== terminalCartId ||
    !repairLegacy
  ) {
    return legacy;
  }
  repairLegacy(legacy.items);
  return { items: legacy.items };
}
