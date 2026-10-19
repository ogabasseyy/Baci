import { capUpdatedSimpleLineQuantity } from './cart-stock-caps';
import type { CartItem } from './cart-types';

/**
 * Quantity-edit line targeting, shared by the applied-ness probe and
 * the cart updater so the two can never diverge: an explicit variant
 * id pins the line, otherwise the V2 cart item id or a variant-less
 * product id matches.
 */
export function findQuantityEditTargetIndex(
  cart: CartItem[],
  cartItemIdOrProductId: string,
  variantId?: string
): number {
  return cart.findIndex((item) => {
    if (variantId) {
      return item.id === cartItemIdOrProductId && item.variantId === variantId;
    }
    return (
      item.cartItemId === cartItemIdOrProductId ||
      (item.id === cartItemIdOrProductId && !item.variantId)
    );
  });
}

/**
 * Probe quantity-edit applied-ness synchronously, mirroring the add
 * path: updaters run later, so an in-updater flag would still read
 * true at the group-deal gate. A missing target or a keepPrevious cap
 * leaves the cart — including per-line negotiated prices — untouched,
 * so the group deal must survive. Same-tick writers can skew the probe
 * the way they can the add probe; the updater stays authoritative for
 * the cart contents.
 */
export function probeQuantityEditApplied({
  cart,
  cartItemIdOrProductId,
  variantId,
  quantity,
}: {
  cart: CartItem[];
  cartItemIdOrProductId: string;
  variantId?: string;
  quantity: number;
}): boolean {
  const probeIndex = findQuantityEditTargetIndex(
    cart,
    cartItemIdOrProductId,
    variantId
  );
  if (probeIndex === -1 || quantity <= 0) {
    // A removal (quantity <= 0) with a found target always applies;
    // a missing target never does.
    return probeIndex !== -1;
  }
  const probeItem = cart[probeIndex];
  const probeMinimum = probeItem.minimum_order_quantity || 1;
  const probeQuantity = quantity < probeMinimum ? probeMinimum : quantity;
  return !(
    'keepPrevious' in
    capUpdatedSimpleLineQuantity({
      item: probeItem,
      cart,
      excludeIndex: probeIndex,
      quantity: probeQuantity,
    })
  );
}

/**
 * Pure quantity-edit updater: removes the line at quantity <= 0,
 * otherwise minimum-clamps and cap-clamps through cart-stock-caps. A
 * quantity change alters the cart total, so an active cart-wide
 * negotiation no longer represents the agreed total — the group deal
 * clears on every line (not only when the line is removed). Returns
 * the same reference when the target is missing or a cap keeps the
 * previous cart.
 */
export function applyStorefrontCartQuantityEdit({
  previousCart,
  cartItemIdOrProductId,
  variantId,
  quantity,
  wasGroupActive,
}: {
  previousCart: CartItem[];
  cartItemIdOrProductId: string;
  variantId?: string;
  quantity: number;
  wasGroupActive: boolean;
}): CartItem[] {
  const targetIndex = findQuantityEditTargetIndex(
    previousCart,
    cartItemIdOrProductId,
    variantId
  );

  if (targetIndex === -1) return previousCart;
  if (quantity <= 0) {
    const filtered = previousCart.filter((_, index) => index !== targetIndex);
    if (wasGroupActive) {
      return filtered.map((item) => ({
        ...item,
        negotiatedPrice: undefined,
        negotiationStatus: undefined,
      }));
    }
    return filtered;
  }

  const nextCart = [...previousCart];
  const item = nextCart[targetIndex];
  const minimumOrderQuantity = item.minimum_order_quantity || 1;
  let nextQuantity =
    quantity < minimumOrderQuantity ? minimumOrderQuantity : quantity;
  // Update-path caps (offer allocation + strict pool) live in
  // cart-stock-caps with the add-path rules.
  const capped = capUpdatedSimpleLineQuantity({
    item,
    cart: previousCart,
    excludeIndex: targetIndex,
    quantity: nextQuantity,
  });
  if ('keepPrevious' in capped) {
    return previousCart;
  }
  nextQuantity = capped.quantity;
  nextCart[targetIndex] = {
    ...item,
    quantity: nextQuantity,
  };
  if (wasGroupActive) {
    return nextCart.map((line) => ({
      ...line,
      negotiatedPrice: undefined,
      negotiationStatus: undefined,
    }));
  }
  return nextCart;
}
