import {
  cartLineIdentity,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';
import type { Product } from '@/lib/products';
import type { AddToCartOptions, SharedCartDisplayItem } from './cart-types';
import {
  cartItemToIdentity,
  displayLineMatchesAddLane,
} from './shared-cart-display-identity';

/**
 * Mirrors the shared add gates (stock, variant selection, per-line cap
 * on the matching attachment lane) so a delegated add that the shared
 * hook would drop as a no-op never voids the group deal first. When a
 * group deal is active, the void reprices negotiated lines into the
 * ordinary lane before the add runs, so capacity is calculated
 * against those post-void lanes.
 */
export function delegatedAddCanBeAccepted(
  display: readonly SharedCartDisplayItem[],
  product: Product,
  quantity: number,
  options?: AddToCartOptions,
  groupDealActive = false
): boolean {
  const productRecord = product as unknown as Record<string, unknown>;
  const isVoucherProduct = Boolean(
    options?.quizVoucherToken ||
      options?.quizAwardId ||
      productRecord.quizVoucherToken ||
      productRecord.isQuizPrize
  );
  if (product.manage_stock && product.stock <= 0 && !isVoucherProduct) {
    return false;
  }
  if (options?.variantRequired && !options?.variantId) return false;
  const key = cartLineIdentity(
    cartItemToIdentity({
      condition: options?.condition,
      id: product.id,
      selectedColor: options?.color,
      selectedColorValue: options?.colorValue,
      selectedStorage: options?.storage,
      secondaryColor: options?.secondaryColor,
      secondaryColorValue: options?.secondaryColorValue,
      variantAttributes: options?.variantAttributes,
      variantId: options?.variantId,
    })
  );
  const voucherToken =
    options?.quizVoucherToken ??
    (typeof productRecord.quizVoucherToken === 'string'
      ? productRecord.quizVoucherToken
      : undefined);
  const voucherAwardId =
    options?.quizAwardId ??
    (typeof productRecord.quizAwardId === 'string'
      ? productRecord.quizAwardId
      : undefined);
  const existing = display
    .filter((line) => {
      if (cartLineIdentity(cartItemToIdentity(line)) !== key) return false;
      const laneLine = groupDealActive
        ? {
            ...line,
            negotiatedPrice: undefined,
            negotiationStatus: undefined,
          }
        : line;
      return displayLineMatchesAddLane(laneLine, {
        voucherToken,
        voucherAwardId,
      });
    })
    .reduce((sum, line) => sum + line.quantity, 0);
  const requested = isVoucherProduct ? 1 : Math.max(1, Math.floor(quantity));
  return Math.min(requested, SHARED_CART_MAX_QUANTITY_PER_LINE - existing) > 0;
}
