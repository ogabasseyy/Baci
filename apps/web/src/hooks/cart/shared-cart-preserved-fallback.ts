import type { CartSnapshot } from '@baci/shared/cart';
import {
  getCartFromStorage,
  getSharedCartImportReceipt,
  saveCartToStorage,
} from './cart-storage';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import type { EnsureCartResult } from './shared-cart-hook-support';
import { adoptPreservedCart } from './shared-cart-preserved-session';
import { isTerminalCart } from './shared-cart-queue';
import { unimportedTerminalLines } from './terminal-cart-cache';
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
  if (!preserved.ok) return null;
  if (isTerminalCart(preserved.snapshot)) {
    const preservedLines = unimportedTerminalLines(
      getCartFromStorage(merchantSlug),
      preserved.snapshot.cartId,
      getSharedCartImportReceipt(merchantSlug)
    );
    saveCartToStorage(preservedLines, merchantSlug);
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
