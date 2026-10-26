import type { CartSnapshot } from '@baci/shared/cart';
import {
  getCartFromStorage,
  getSharedCartImportReceipt,
  saveCartToStorage,
  saveSharedCartImportReceipt,
} from './cart-storage';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import type { EnsureCartResult } from './shared-cart-hook-support';
import { adoptPreservedCart } from './shared-cart-preserved-session';
import { isTerminalCart } from './shared-cart-queue';
import {
  terminalCachePersisted,
  terminalConsumptionCheckpoint,
  unimportedTerminalLines,
} from './terminal-cart-cache';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

type FallbackContext = SharedCartRuntime & {
  hydrateMissing?: (snapshot: CartSnapshot) => Promise<void>;
};
/** Adopt the preserved session after an unauthorized create, retiring it if already terminal. */
export async function adoptPreservedFallback(
  context: FallbackContext,
  merchantSlug: string | null | undefined,
  fenced: () => boolean,
  retryProvisioning: () => Promise<EnsureCartResult>
): Promise<EnsureCartResult> {
  const preserved = await fetchSharedCartSnapshot(undefined, merchantSlug);
  if (!fenced()) return null;
  if (!preserved.ok) {
    // A transient read must not strand the cart behind the populated
    // create request: drop it so the retry can re-enter this fallback
    // (the definitive unauthorized create makes replay safe to redo).
    if (preserved.retryable) {
      context.createRequestRef.current = null;
      return {
        ok: false,
        code: 'temporarily_unavailable',
        retryable: true,
      };
    }
    return null;
  }
  if (isTerminalCart(preserved.snapshot)) {
    const preservedLines = unimportedTerminalLines(
      getCartFromStorage(merchantSlug),
      preserved.snapshot.cartId,
      getSharedCartImportReceipt(merchantSlug)
    );
    saveCartToStorage(preservedLines, merchantSlug);
    // Provisioning re-reads storage: if the filtered cache did not
    // persist, retrying would recreate already-consumed items.
    const persistedOk = terminalCachePersisted(
      getCartFromStorage(merchantSlug),
      preservedLines
    );
    if (!persistedOk) {
      // The create was definitively rejected: clear it so the retry
      // can re-enter this fallback instead of repeating the create
      // under the terminal proof and stranding recovery.
      context.createRequestRef.current = null;
      return {
        ok: false,
        code: 'temporarily_unavailable',
        retryable: true,
      };
    }
    const checkpoint = terminalConsumptionCheckpoint(
      getSharedCartImportReceipt(merchantSlug),
      preserved.snapshot.cartId
    );
    if (checkpoint) saveSharedCartImportReceipt(merchantSlug, checkpoint);
    context.retiredCartIdRef.current = preserved.snapshot.cartId;
    context.adoptOutcomeRef.current = 'expired';
    context.createRequestRef.current = null;
    context.createAttemptedRef.current = false;
    context.createOpRef.current = crypto.randomUUID();
    return retryProvisioning();
  }
  if (!adoptPreservedCart(context, preserved.snapshot))
    return { ok: false, code: 'temporarily_unavailable', retryable: true };
  context.createRequestRef.current = null;
  void context.hydrateMissing?.(preserved.snapshot);
  return { ok: true };
}
