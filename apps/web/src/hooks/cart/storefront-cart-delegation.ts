import type { SharedCartDisplayItem } from './cart-types';

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
