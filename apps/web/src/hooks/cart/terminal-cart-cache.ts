import type { SharedCartDisplayItem } from './cart-types';
import { identityKeyOfDisplay } from './shared-cart-display-identity';
import type { SharedCartImportReceipt } from './shared-cart-storage';

/** Verify a filtered terminal cache landed in storage with lanes and quantities intact. */
export function terminalCachePersisted(
  persisted: SharedCartDisplayItem[],
  expected: SharedCartDisplayItem[]
): boolean {
  return (
    persisted.length === expected.length &&
    persisted.every((line, index) => {
      const want = expected[index];
      return (
        line.cartItemId === want.cartItemId &&
        line.quantity === want.quantity &&
        line.serverLineId === want.serverLineId &&
        identityKeyOfDisplay(line) === identityKeyOfDisplay(want) &&
        line.offerId === want.offerId &&
        line.quizVoucherToken === want.quizVoucherToken &&
        line.quizAwardId === want.quizAwardId &&
        line.negotiatedPrice === want.negotiatedPrice &&
        line.negotiationStatus === want.negotiationStatus &&
        (line.hasAssurance ?? false) === (want.hasAssurance ?? false) &&
        line.assuranceRate === want.assuranceRate
      );
    })
  );
}
/**
 * Checkpoint a persisted terminal filter: the saved remainder is the
 * new baseline, so a reload re-filtering it against the terminal
 * receipt must retain it whole instead of subtracting the imported
 * quantities a second time.
 */
export function terminalConsumptionCheckpoint(
  receipt: SharedCartImportReceipt | null,
  terminalCartId: string
): SharedCartImportReceipt | null {
  // A receipt from a different cart needs no checkpoint: the filter
  // already treats it as unrelated, and verifying it against this
  // terminal cart would fail unconditionally.
  if (!receipt || receipt.cartId !== terminalCartId) return null;
  return {
    ...receipt,
    lineCount: 0,
    ...(receipt.consumedQuantities
      ? {
          consumedQuantities: Object.fromEntries(
            Object.keys(receipt.consumedQuantities).map((id) => [id, 0])
          ),
        }
      : {}),
  };
}

/** Verify a checkpointed receipt actually landed in storage. */
export function terminalCheckpointPersisted(
  receipt: SharedCartImportReceipt | null,
  terminalCartId: string
): boolean {
  if (!receipt || receipt.cartId !== terminalCartId) return false;
  if (receipt.lineCount !== 0) return false;
  return Object.values(receipt.consumedQuantities ?? {}).every(
    (quantity) => quantity === 0
  );
}

/** A stable server line ID marks consumed canonical data, not a new device import. */
export function unimportedTerminalLines(
  cached: SharedCartDisplayItem[],
  terminalCartId: string,
  receipt: SharedCartImportReceipt | null
): SharedCartDisplayItem[] {
  const fresh = cached.filter((line) => !line.serverLineId);
  if (receipt?.cartId !== terminalCartId) return fresh;
  // Stable per-line identity wins over counts: the receipt records the
  // exact device lines the import consumed, so post-import edits,
  // reordering, or merged plans cannot misclassify a fresh line.
  if (receipt.consumedCartItemIds?.length) {
    const consumed = new Set(receipt.consumedCartItemIds);
    const quantities = receipt.consumedQuantities;
    // cartItemId is deterministic per product/options lane, so a
    // post-import quantity edit reuses the consumed ID and duplicate
    // rows can share it: retain only the aggregate increase over the
    // imported source quantity for that ID, allocated in row order.
    const totals = new Map<string, number>();
    for (const line of fresh) {
      if (!line.cartItemId || !consumed.has(line.cartItemId)) continue;
      totals.set(
        line.cartItemId,
        (totals.get(line.cartItemId) ?? 0) + line.quantity
      );
    }
    const budgets = new Map<string, number>();
    for (const id of consumed) {
      const source = quantities?.[id];
      budgets.set(
        id,
        source === undefined ? 0 : Math.max(0, (totals.get(id) ?? 0) - source)
      );
    }
    return fresh.flatMap((line) => {
      if (!line.cartItemId || !consumed.has(line.cartItemId)) return [line];
      const budget = budgets.get(line.cartItemId) ?? 0;
      const take = Math.min(line.quantity, budget);
      budgets.set(line.cartItemId, budget - take);
      return take > 0 ? [{ ...line, quantity: take }] : [];
    });
  }
  // A matching receipt consumes the imported source set, but fresh
  // device-only writes after the import still lack a server line ID.
  // A pure source cache (no mirrors) matching the receipt count is
  // fully consumed; a mixed cache keeps its post-import writes.
  const mirrors = cached.length - fresh.length;
  if (mirrors > 0) return fresh;
  if (fresh.length <= receipt.lineCount) return [];
  // Count-only fallback: this positional slice is only sound for an
  // unmodified source cache (storage order equals import order, as
  // written by the import itself). Receipts carrying consumed IDs
  // take the identity-based path above and are reorder-safe.
  return fresh.slice(receipt.lineCount);
}
