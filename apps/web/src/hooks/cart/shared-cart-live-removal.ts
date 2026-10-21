import { cartLineIdentity } from '@baci/shared/cart';
import type { CartItem } from './cart-types';
import {
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { identityKeyOfDisplay } from './shared-cart-display-identity';
import { isTerminalCart } from './shared-cart-queue';

/**
 * Remove one saved device line from a live server cart that another tab
 * created while a capacity removal was queued behind its create. The
 * parked-cache edit cannot undo that create, so the matching server
 * line is reduced by the removed row's quantity (or removed when the
 * quantities match). Returns false when the live cart could not be
 * updated, so the caller can surface a retryable error.
 */
export async function removeCapacityLineFromLiveCart(
  selected: CartItem,
  merchantSlug: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fetched = await fetchSharedCartSnapshot(undefined, merchantSlug);
    // not_found/unauthorized mean there is no live cart to update;
    // a retryable fetch failure leaves the outcome unknown, so report
    // failure instead of silently leaving the line in the live cart.
    if (!fetched.ok) return !fetched.retryable;
    const snapshot = fetched.snapshot;
    if (isTerminalCart(snapshot)) return true;
    const key = identityKeyOfDisplay(selected);
    const line = snapshot.lines.find(
      (candidate) =>
        cartLineIdentity(candidate.item) === key &&
        (candidate.voucherToken ?? undefined) ===
          (selected.quizVoucherToken ?? undefined) &&
        (candidate.voucherAwardId ?? undefined) ===
          (selected.quizAwardId ?? undefined) &&
        (candidate.negotiatedUnitPriceMinor ?? undefined) ===
          (selected.negotiatedPrice == null
            ? undefined
            : Math.round(selected.negotiatedPrice * 100)) &&
        (candidate.negotiationStatus ?? 'none') ===
          (selected.negotiationStatus ?? 'none') &&
        (candidate.hasAssurance ?? false) ===
          (selected.hasAssurance ?? false) &&
        (candidate.assuranceRate ?? undefined) ===
          (selected.assuranceRate ?? undefined)
    );
    if (!line) return true;
    const remainingQuantity = line.quantity - selected.quantity;
    const result = await sendSharedCartCommand(
      {
        command:
          remainingQuantity > 0
            ? {
                type: 'set_quantity',
                lineId: line.id,
                quantity: remainingQuantity,
              }
            : { type: 'remove', lineId: line.id },
        expectedVersion: snapshot.version,
        operationId: crypto.randomUUID(),
      },
      merchantSlug
    );
    if (result.ok) return true;
    if (result.code !== 'version_conflict') return false;
  }
  return false;
}
