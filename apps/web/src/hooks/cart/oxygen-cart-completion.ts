import type { CartItem } from './cart-types';

export interface OxygenPurchasedCartLine {
  cartItemId: string;
  instanceId: string;
  quantity: number;
}

/** Match the original line instance; re-added lines have a new identity. */
export function removeOxygenPurchasedLines(
  cart: CartItem[],
  purchased: OxygenPurchasedCartLine[]
): CartItem[] {
  const result: CartItem[] = [];
  for (const item of cart) {
    const original = purchased.find(
      (line) =>
        line.cartItemId === item.cartItemId &&
        line.instanceId === item.cartLineInstanceId
    );
    if (!original) {
      result.push(item);
      continue;
    }
    const remaining = item.quantity - original.quantity;
    if (remaining > 0) result.push({ ...item, quantity: remaining });
  }
  return result;
}
