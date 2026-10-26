import { cartLineIdentity } from '@baci/shared/cart';
import { getCartCookieEpoch } from './cart-cross-tab-lock';
import { hasActiveCartDeviceSession } from './cart-device-session-markers';
import type { CartItem } from './cart-types';
import {
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { identityKeyOfDisplay } from './shared-cart-display-identity';
import { isTerminalCart } from './shared-cart-queue';
import { getCartSessionGeneration } from './shared-cart-storage';

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
  // Re-fetch and re-plan on conflict or indeterminate responses so a
  // concurrent mutation cannot leave a partially-voided group deal.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fetched = await fetchSharedCartSnapshot(undefined, merchantSlug);
    if (!fetched.ok) return false;
    if (isTerminalCart(fetched.snapshot)) return true;
    let version = fetched.snapshot.version;
    let replanned = false;
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
      if (!cleared.ok) {
        replanned = true;
        break;
      }
      version = cleared.snapshot.version;
    }
    if (!replanned) return true;
  }
  return false;
}

export async function removeCapacityLineFromLiveCart(
  selected: CartItem,
  merchantSlug: string,
  options?: {
    clearGroupNegotiations?: boolean;
    expectedEpoch?: string | null;
    expectedGeneration?: number;
  }
): Promise<boolean> {
  // A newer capacity edit, retirement, or session generation since
  // the parked-cache trim supersedes this reconciliation: a late
  // removal must not subtract from a line re-added in the meantime.
  const fenceCurrent = () => {
    if (options?.expectedEpoch != null) {
      const epochNow = getCartCookieEpoch(merchantSlug);
      if (epochNow !== undefined && epochNow !== options.expectedEpoch)
        return false;
    }
    if (
      options?.expectedGeneration != null &&
      getCartSessionGeneration(merchantSlug) !== options.expectedGeneration
    )
      return false;
    return true;
  };
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
  let operationId = crypto.randomUUID();
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
    if (!fenceCurrent()) return true;
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
    if (result.code === 'version_conflict') {
      // A version conflict is a definitive response: the retry may
      // send a different body, so it needs a fresh idempotency key.
      operationId = crypto.randomUUID();
      continue;
    }
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
