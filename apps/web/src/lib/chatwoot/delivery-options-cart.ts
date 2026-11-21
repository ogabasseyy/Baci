import 'server-only';

import type { CartLine, CartSnapshot } from '@baci/shared/cart';

const MAX_DELIVERY_OPTION_CART_LINES = 20;

/** Validate the exact cart invariants used before and after rate lookup. */
export function isChatwootDeliveryOptionsCartValid(
  cart: CartSnapshot
): boolean {
  return (
    cart.currency === 'NGN' &&
    !cart.estimatedTotals &&
    Number.isSafeInteger(cart.version) &&
    cart.version >= 0 &&
    Number.isSafeInteger(cart.subtotalMinor) &&
    cart.subtotalMinor >= 0 &&
    cart.lines.length > 0 &&
    cart.lines.length <= MAX_DELIVERY_OPTION_CART_LINES &&
    cart.lines.every(
      (line) =>
        typeof line.id === 'string' &&
        line.id.length > 0 &&
        typeof line.item.productId === 'string' &&
        line.item.productId.length > 0 &&
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0 &&
        Number.isSafeInteger(line.unitPriceMinor) &&
        line.unitPriceMinor >= 0 &&
        Number.isSafeInteger(line.lineTotalMinor) &&
        line.lineTotalMinor >= 0
    ) &&
    cart.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0) ===
      cart.subtotalMinor
  );
}

/**
 * A cart version should change whenever any line changes. Compare the loaded
 * lines too, so a bad/stale snapshot with a recycled version cannot pass the
 * post-provider recheck just because its subtotal stayed the same.
 */
export function haveSameChatwootDeliveryOptionLines(
  left: CartLine[],
  right: CartLine[]
): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => {
      const other = right[index];
      return (
        line.id === other.id &&
        line.item.productId === other.item.productId &&
        line.item.variantId === other.item.variantId &&
        line.item.condition === other.item.condition &&
        haveSameItemOptions(line.item.options, other.item.options) &&
        line.quantity === other.quantity &&
        line.unitPriceMinor === other.unitPriceMinor &&
        line.lineTotalMinor === other.lineTotalMinor &&
        line.negotiatedUnitPriceMinor === other.negotiatedUnitPriceMinor &&
        line.negotiationStatus === other.negotiationStatus &&
        line.voucherToken === other.voucherToken &&
        line.voucherAwardId === other.voucherAwardId &&
        line.hasAssurance === other.hasAssurance &&
        line.assuranceRate === other.assuranceRate
      );
    })
  );
}

function haveSameItemOptions(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined
): boolean {
  if (!left || !right) return left === right;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key]
    )
  );
}
