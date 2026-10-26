import type { CartSnapshot } from '@baci/shared/cart';
import {
  getCartFromStorage,
  getSharedCartImportReceipt,
  saveCartToStorage,
  saveSharedCartImportReceipt,
} from './cart-storage';
import type { CartItem } from './cart-types';
import { isCartDeviceRevocationPending } from './shared-cart-session-revoke-client';
import {
  terminalCachePersisted,
  terminalCheckpointPersisted,
  terminalConsumptionCheckpoint,
  unimportedTerminalLines,
} from './terminal-cart-cache';

export type TerminalAdoptionOutcome =
  | { kind: 'provision'; cached: CartItem[] }
  | { kind: 'retry' }
  | { kind: 'settled'; cached: CartItem[] };

/**
 * Filter the parked device cache against a terminal snapshot, persist
 * the remainder with its consumption checkpoint, and report whether
 * provisioning should proceed, retry, or fall through.
 */
export function adoptTerminalSnapshotCache(
  merchantSlug: string | null | undefined,
  snapshot: CartSnapshot
): TerminalAdoptionOutcome {
  // Decide recovery from a fresh read, not the effect-start copy:
  // another tab may have written fresher device lines while the fetch
  // was awaited. A pending revocation parks the cache, so it reads
  // as empty.
  const storedNow = isCartDeviceRevocationPending(merchantSlug)
    ? []
    : getCartFromStorage(merchantSlug);
  const cached = unimportedTerminalLines(
    storedNow,
    snapshot.cartId,
    getSharedCartImportReceipt(merchantSlug)
  );
  if (cached.length) {
    // Provisioning reads the parked source again: remove only consumed mirror lines.
    saveCartToStorage(cached, merchantSlug);
    // Provisioning re-reads storage: if the filtered cache did
    // not persist, it would recreate already-consumed items.
    if (!terminalCachePersisted(getCartFromStorage(merchantSlug), cached))
      return { kind: 'retry' };
    // The filtered remainder is the new baseline: checkpoint the
    // receipt so a reload cannot subtract it twice.
    const checkpoint = terminalConsumptionCheckpoint(
      getSharedCartImportReceipt(merchantSlug),
      snapshot.cartId
    );
    if (checkpoint) {
      saveSharedCartImportReceipt(merchantSlug, checkpoint);
      if (
        !terminalCheckpointPersisted(
          getSharedCartImportReceipt(merchantSlug),
          snapshot.cartId
        )
      ) {
        // Roll the filtered cache back so a reload cannot re-filter
        // it against the original receipt.
        saveCartToStorage(storedNow, merchantSlug);
        return { kind: 'retry' };
      }
    }
    return { kind: 'provision', cached };
  }
  if (storedNow.length) {
    // Every cached row was consumed by the terminal cart: persist the
    // empty filter so mirrored rows cannot be re-planned as a fresh
    // import once the proof expires.
    saveCartToStorage([], merchantSlug);
    if (getCartFromStorage(merchantSlug).length) return { kind: 'retry' };
  }
  return { kind: 'settled', cached };
}
