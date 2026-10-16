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
 * Pure delegation helpers for the storefront cart provider, extracted
 * so the provider file stays focused on cart state orchestration.
 *
 * `delegatedLineTarget` replicates the shared hook's first-match
 * targeting so group-deal void exclusions cover exactly the line a
 * delegated edit will touch. `planGroupDealVoid` mirrors the legacy
 * group-deal reset (an edit breaks the agreed group total) as the set
 * of server lines to reprice back to list: lines the edit itself
 * targets are excluded (clearing one would retire its server line ID
 * and fail the edit with a stale-target error), and quantity overrides
 * cover edits queued ahead of their void, whose re-added lines must
 * carry the new quantity instead of the pre-edit display quantity.
 */
export function delegatedLineTarget(
  display: readonly SharedCartDisplayItem[],
  cartItemIdOrProductId: string,
  variantId?: string
): SharedCartDisplayItem | null {
  const exact = display.find(
    (line) => line.cartItemId === cartItemIdOrProductId
  );
  if (exact) return exact;
  return (
    display.find((line) => {
      if (line.id !== cartItemIdOrProductId) return false;
      if (variantId !== undefined) return line.variantId === variantId;
      return line.variantId === undefined;
    }) ?? null
  );
}

/**
 * Mirrors the shared add gates (stock, variant selection, per-line cap
 * on the matching attachment lane) so a delegated add that the shared
 * hook would drop as a no-op never voids the group deal first.
 */
export function delegatedAddCanBeAccepted(
  display: readonly SharedCartDisplayItem[],
  product: Product,
  quantity: number,
  options?: AddToCartOptions
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
    .filter(
      (line) =>
        cartLineIdentity(cartItemToIdentity(line)) === key &&
        displayLineMatchesAddLane(line, { voucherToken, voucherAwardId })
    )
    .reduce((sum, line) => sum + line.quantity, 0);
  const requested = isVoucherProduct ? 1 : Math.max(1, Math.floor(quantity));
  return Math.min(requested, SHARED_CART_MAX_QUANTITY_PER_LINE - existing) > 0;
}

export function planGroupDealVoid(
  display: readonly SharedCartDisplayItem[],
  exceptCartItemId?: string,
  quantityOverrides?: ReadonlyMap<string, number>
): SharedCartDisplayItem[] {
  const lines: SharedCartDisplayItem[] = [];
  for (const line of display) {
    if (
      line.negotiatedPrice === undefined &&
      line.negotiationStatus === undefined
    ) {
      continue;
    }
    if (exceptCartItemId === line.cartItemId) continue;
    const quantity = quantityOverrides?.get(line.cartItemId);
    lines.push(quantity === undefined ? line : { ...line, quantity });
  }
  return lines;
}
