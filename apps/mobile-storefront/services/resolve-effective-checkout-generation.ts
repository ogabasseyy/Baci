import type { CheckoutAttemptKeyOptions } from '@/lib/checkout-attempt-key';
import { checkoutGenerationRestoreGate } from '@/lib/checkout-generation-restore-gate';
import { resolveCheckoutGeneration } from '@/lib/resolve-checkout-generation';
import { useCartStore } from '@/stores/cart-store';

export async function resolveEffectiveCheckoutGeneration({
  checkoutGeneration,
  frozenCheckoutGeneration,
  queuedReplay,
}: {
  checkoutGeneration: string;
  frozenCheckoutGeneration?: string;
  queuedReplay?: boolean;
}): Promise<{
  attemptKeyOptions: CheckoutAttemptKeyOptions | undefined;
  effectiveCheckoutGeneration: string;
}> {
  // The cart generation can be stale while the dedicated persisted
  // generation still identifies a lost-response attempt. Resolve the
  // effective generation once and freeze the payload under it, so the
  // submitted body and the hashed key observe the same credit snapshot.
  let effectiveFrozenGeneration = frozenCheckoutGeneration;
  if (frozenCheckoutGeneration !== undefined) {
    // Await the startup restore so a stale pre-rehydrate cart snapshot
    // cannot clobber the durable lost-response identity below.
    await checkoutGenerationRestoreGate.waitForRestore();
    const liveGeneration = useCartStore.getState().checkoutGeneration;
    if (
      queuedReplay !== true &&
      liveGeneration !== frozenCheckoutGeneration &&
      liveGeneration === checkoutGenerationRestoreGate.lastRestoredGeneration()
    ) {
      // The caller's snapshot predates the restore: the live cart now
      // carries the durable identity, which wins over the stale pin.
      // Queued replays keep their pin — the live cart there belongs to a
      // newer purchase, not to this attempt.
      effectiveFrozenGeneration = liveGeneration;
    }
  }
  const attemptKeyOptions = effectiveFrozenGeneration
    ? {
        frozen: true,
        persistFrozen: queuedReplay !== true,
        liveGeneration: useCartStore.getState().checkoutGeneration,
      }
    : undefined;
  const effectiveCheckoutGeneration = await resolveCheckoutGeneration(
    effectiveFrozenGeneration ?? checkoutGeneration,
    attemptKeyOptions
  );
  return { attemptKeyOptions, effectiveCheckoutGeneration };
}
