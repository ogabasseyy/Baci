import { cartLineIdentity } from '@baci/shared/cart';
import { hasActiveCartDeviceSession } from './cart-device-session-markers';
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
async function clearLiveGroupNegotiations(
  merchantSlug: string
): Promise<boolean> {
  const fetched = await fetchSharedCartSnapshot(undefined, merchantSlug);
  if (!fetched.ok) return false;
  if (isTerminalCart(fetched.snapshot)) return true;
  let version = fetched.snapshot.version;
  for (const line of fetched.snapshot.lines) {
    if (
      line.negotiatedUnitPriceMinor == null &&
      (line.negotiationStatus ?? 'none') === 'none'
    )
      continue;
    const cleared = await sendSharedCartCommand(
      {
        command: {
          type: 'set_negotiated_price',
          lineId: line.id,
          negotiatedUnitPriceMinor: null,
        },
        expectedVersion: version,
        operationId: crypto.randomUUID(),
      },
      merchantSlug
    );
    if (!cleared.ok) return false;
    version = cleared.snapshot.version;
  }
  return true;
}

export async function removeCapacityLineFromLiveCart(
  selected: CartItem,
  merchantSlug: string,
  options?: { clearGroupNegotiations?: boolean }
): Promise<boolean> {
  const key = identityKeyOfDisplay(selected);
  const findLine = (lines: import('@baci/shared/cart').CartSnapshot['lines']) =>
    lines.find(
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
        // Device rows carry a default rate even when assurance is
        // off, while server lines store none: only compare the rate
        // for assured lines, or unassured lines never match.
        (!(selected.hasAssurance ?? false) ||
          (candidate.assuranceRate ?? undefined) ===
            (selected.assuranceRate ?? undefined))
    );
  // One operation ID per removal: an indeterminate response is
  // replayed/reconciled under the same identity instead of minting a
  // second, unrelated command.
  const operationId = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fetched = await fetchSharedCartSnapshot(undefined, merchantSlug);
    // not_found/unauthorized mean there is no live cart to update;
    // a retryable fetch failure leaves the outcome unknown, so report
    // failure instead of silently leaving the line in the live cart.
    // With no known device session there is no live cart to reconcile,
    // so a transient failure must not fail the saved-cart trim.
    if (!fetched.ok)
      return !fetched.retryable || !hasActiveCartDeviceSession(merchantSlug);
    const snapshot = fetched.snapshot;
    if (isTerminalCart(snapshot)) return true;
    const line = findLine(snapshot.lines);
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
        operationId,
      },
      merchantSlug
    );
    if (result.ok)
      return options?.clearGroupNegotiations
        ? clearLiveGroupNegotiations(merchantSlug)
        : true;
    if (result.code === 'version_conflict') continue;
    // Indeterminate: the command may have committed despite the lost
    // response. Re-fetch and reconcile before reporting failure.
    const check = await fetchSharedCartSnapshot(undefined, merchantSlug);
    if (!check.ok) return false;
    if (isTerminalCart(check.snapshot)) return true;
    const settled = findLine(check.snapshot.lines);
    const reconciled =
      !settled || settled.quantity <= Math.max(remainingQuantity, 0);
    if (!reconciled) return false;
    return options?.clearGroupNegotiations
      ? clearLiveGroupNegotiations(merchantSlug)
      : true;
  }
  return false;
}
