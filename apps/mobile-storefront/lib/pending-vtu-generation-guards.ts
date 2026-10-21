import {
  forgetPendingVtuPurchase,
  forgetPendingVtuPurchaseDurable,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  recallPendingVtuKey,
} from './pending-vtu-idempotency';

/**
 * Generation-guarded pending-VTU registry mutations (Codex R6 P1).
 *
 * On Expo web, tabs share the MMKV/localStorage bucket and sync each
 * other's generations (R143): a delayed join response for loser key
 * K1 can arrive after another tab settled K1 and minted K2 for the
 * same descriptor. The canonical adoption then correctly vetoes its
 * stale rebind — but settling K1's terminal result by SCOPE would
 * still delete K2, and K2's lost-response retry would mint K3 and
 * debit/vend twice. Every mutation here runs only when the live
 * entry still holds the caller's expected generation
 * (canonical-after-adoption, else submitted); vetoed/missing
 * generations are left untouched so the caller settles
 * presentation-only. The liveness read syncs first, so it sees
 * sibling tabs' latest persisted state.
 */
function ownsPendingVtuGeneration(
  descriptor: string,
  expectedKey: string
): boolean {
  return recallPendingVtuKey(descriptor) === expectedKey;
}

/** Notes the reference only when the expected generation is live. */
export function noteOwnPendingVtuReference(
  descriptor: string,
  reference: string,
  expectedKey: string
): void {
  if (ownsPendingVtuGeneration(descriptor, expectedKey)) {
    notePendingVtuReference(descriptor, reference);
  }
}

/** Records completion only when the expected generation is live. */
export function markOwnPendingVtuCompleted(
  descriptor: string,
  expectedKey: string
): void {
  if (ownsPendingVtuGeneration(descriptor, expectedKey)) {
    markPendingVtuCompleted(descriptor);
  }
}

/**
 * Stale-success probe scoped to the expected generation: a vetoed
 * response must neither trigger the already-completed branch nor
 * fall through to a scope forget — false routes it to present.
 */
export function isOwnPendingVtuStaleSuccess(
  descriptor: string,
  reference: string,
  expectedKey: string,
  now: number = Date.now()
): boolean {
  if (!ownsPendingVtuGeneration(descriptor, expectedKey)) {
    return false;
  }
  return isStalePendingVtuSuccess(descriptor, reference, now);
}

/**
 * Durable scope forget scoped to the expected generation. False
 * when skipped (vetoed/missing) — the caller still presents.
 */
export async function forgetOwnPendingVtuPurchaseDurable(
  descriptor: string,
  expectedKey: string
): Promise<boolean> {
  if (!ownsPendingVtuGeneration(descriptor, expectedKey)) {
    return false;
  }
  return await forgetPendingVtuPurchaseDurable(descriptor);
}

/** Sync scope forget scoped to the expected generation. */
export function forgetOwnPendingVtuPurchase(
  descriptor: string,
  expectedKey: string
): void {
  if (ownsPendingVtuGeneration(descriptor, expectedKey)) {
    forgetPendingVtuPurchase(descriptor);
  }
}
