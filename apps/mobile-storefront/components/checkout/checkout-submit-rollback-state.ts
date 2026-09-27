import { checkoutCreditSnapshotStore } from '@/lib/checkout-credit-snapshot-store';
import { usesCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';

async function captureCheckoutSubmitRollbackState(
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
  // An inconclusive read (timeout or rejection) is NOT degraded to
  // undefined: after a restart the registry fallback would report every
  // unknown generation as unmarked legacy, and restoring the cart without
  // its code-point marker would fork the retry's idempotency key. The
  // failure propagates so the submit path skips cleanup entirely instead
  // of proceeding with an unknown sort mode.
  const hadSortMarker = await usesCodepointCheckoutItemSort(checkoutGeneration);
  return { creditFields, hadSortMarker };
}

export async function tryCaptureCheckoutSubmitRollbackState(
  checkoutGeneration: string,
  liveCreditFields: Record<string, unknown>
): Promise<
  | {
      creditFields: Record<string, unknown>;
      hadSortMarker: boolean | undefined;
      ok: true;
    }
  | { ok: false }
> {
  // An inconclusive sort-marker read resolves to ok:false instead of
  // throwing, so the submit path can skip cleanup without catching.
  try {
    const captured = await captureCheckoutSubmitRollbackState(
      checkoutGeneration,
      liveCreditFields
    );
    return { ...captured, ok: true };
  } catch {
    return { ok: false };
  }
}
