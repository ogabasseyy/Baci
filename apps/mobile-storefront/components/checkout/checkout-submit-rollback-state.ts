import { checkoutCreditSnapshotStore } from '@/lib/checkout-credit-snapshot-store';
import { usesCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';

export function trackSubmittedCheckoutGeneration(fallbackGeneration: string): {
  current: () => string;
  track: (orderResponse: { effectiveCheckoutGeneration?: string }) => void;
} {
  // The generation the order was actually submitted under. createOrder
  // resolves the stale cart snapshot against the durable restore, and
  // every recovery step must follow the submitted identity — not the
  // snapshot — or a retry forks the idempotency key and duplicates the
  // order. Until createOrder returns, no order exists, so the snapshot
  // remains the correct identity for the pre-submit path.
  let submitted = fallbackGeneration;
  return {
    current: () => submitted,
    track: (orderResponse) => {
      submitted =
        orderResponse.effectiveCheckoutGeneration ?? fallbackGeneration;
    },
  };
}

export async function captureCheckoutSubmitRollbackState(
  checkoutGeneration: string,
  liveCreditFields: Record<string, unknown>
): Promise<{
  creditFields: Record<string, unknown>;
  hadSortMarker: boolean | undefined;
}> {
  // Prefer the frozen choice actually submitted: a retry may have
  // substituted stored values when the shopper edited credit fields
  // mid-flight, and the rollback path must re-freeze submitted values.
  const creditFields =
    checkoutCreditSnapshotStore.completedChoice(checkoutGeneration) ??
    liveCreditFields;
  // Capture the pre-cleanup sort-marker state while it is still durable:
  // the process-local minted registry is empty after a restart, so it
  // cannot tell a released current-generation marker from a legacy gap.
  // A failed read degrades to undefined and the restore falls back to
  // the minted registry, which covers the same-process case.
  let hadSortMarker: boolean | undefined;
  try {
    hadSortMarker = await usesCodepointCheckoutItemSort(checkoutGeneration);
  } catch {
    hadSortMarker = undefined;
  }
  return { creditFields, hadSortMarker };
}
