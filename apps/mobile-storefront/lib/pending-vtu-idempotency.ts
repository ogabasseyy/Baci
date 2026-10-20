/**
 * Cross-mount recall for wallet-only VTU idempotency keys: retries
 * reuse the key and the route's row dedupes, never double-charges.
 *
 * Entries key by canonical descriptor (server-fingerprint mirror),
 * owner+merchant scoped then digested. Deletion rule (R68): only a
 * view that just showed a result may forget it; background passes
 * mark successes stale so suppressed outcomes replay.
 *
 * Durability: MMKV. Uniform 7-day TTL; 5-minute stale window within.
 * Map/persist/merge live in pending-vtu-idempotency-sync.ts (web
 * parity; split per the 300-line module-size gate, Codex R145 P1);
 * ops live here.
 */

import * as Crypto from 'expo-crypto';
import { isExpiredPendingVtuEntry } from './pending-vtu-idempotency-codec';
import {
  clearForgottenVtuScopes,
  clearPendingVtuSnapshot,
  forgottenVtuScopes,
  noteForgottenVtuScopes,
} from './pending-vtu-idempotency-store';
import {
  pendingPurchases,
  persistPendingVtuPurchases,
  runPendingVtuMintLocked,
  schedulePendingVtuFlush,
  syncPendingVtuPurchasesFromSnapshot,
} from './pending-vtu-idempotency-sync';
import {
  hasNotedPendingVtuReferenceIn,
  isStalePendingVtuSuccessIn,
  listNotedPendingVtuReferencesFrom,
  markPendingVtuCompletedIn,
} from './pending-vtu-reference-queries';

export { adoptCanonicalVtuKey } from './pending-vtu-canonical-adoption';
export {
  forgetPendingVtuPurchaseDurable,
  hydratePendingVtuPurchases,
  serializePendingVtuPurchases,
  syncPendingVtuPurchasesFromSnapshot,
} from './pending-vtu-idempotency-sync';

/** Sequential mobile UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

/**
 * Recall window: resolutions land within seconds; an older replay
 * is a NEW intent reusing a completed key — applying it would
 * present the earlier vend as the new purchase.
 */
export const PENDING_VTU_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Key previously used for this exact purchase, if still pending.
 * Referenced-but-uncompleted entries outlive the 7-day TTL (the
 * server leaves unconfirmed rows processing indefinitely); all
 * other TTL-aged entries drop.
 */
export function recallPendingVtuKey(
  descriptor: string,
  now: number = Date.now()
): string | null {
  // Import sibling-tab keys first (Codex R143 P1): without this,
  // an already-open tab misses a key another tab persisted, mints
  // fresh, and the server debits a second transaction.
  syncPendingVtuPurchasesFromSnapshot(now);
  const pending = pendingPurchases.get(descriptor);
  if (!pending) return null;
  if (isExpiredPendingVtuEntry(pending, now)) {
    pendingPurchases.delete(descriptor);
    schedulePendingVtuFlush();
    return null;
  }
  return pending.key;
}

/**
 * Frees one slot by dropping an EXPIRED entry (recall would drop it
 * anyway). TTL-retained entries are never victims — the registry
 * overflows instead (their retry would mint fresh and double-debit).
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingPurchases) {
    if (isExpiredPendingVtuEntry(entry, now)) {
      pendingPurchases.delete(scoped);
      return;
    }
  }
}

/**
 * Records the key (cap-enforced). New generations supersede the
 * scope tombstone only once durable (R94 P2, R99 P2); false when
 * memory-only — dropped AND the tombstone restored (R96 P1).
 */
/** Memory admission for a minted key, cap-enforced (sync; scheduled locked flush — R152 P1, web mirror). */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string,
  scopeTag?: string
): void {
  if (
    !pendingPurchases.has(descriptor) &&
    pendingPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  pendingPurchases.delete(descriptor);
  forgottenVtuScopes.delete(descriptor);
  pendingPurchases.set(descriptor, {
    key,
    reference: null,
    ...(scopeTag !== undefined ? { scopeTag } : {}),
    rememberedAt: Date.now(),
    completedAt: null,
  });
  schedulePendingVtuFlush();
}

const PENDING_VTU_STORAGE_ERROR =
  'Could not save this purchase for retry. Please try again.';

/**
 * Recall-or-mint choke point (R148, mutex R149, web mirror) under
 * the navigator.locks mint mutex on Expo web. Throws the storage
 * error when the lock is unacquired or the mint is undurable.
 */
export function getPendingVtuKey(
  descriptor: string,
  scopeTag?: string
): Promise<string> {
  return runPendingVtuMintLocked(() => {
    const recalled = recallPendingVtuKey(descriptor);
    if (recalled) {
      return recalled;
    }
    const minted = Crypto.randomUUID();
    // Inline persist under the held lock (R152 P1) + rollback on
    // failure (R99 P2): the save must be atomic with the recall.
    const priorTombstone = forgottenVtuScopes.get(descriptor);
    rememberPendingVtuPurchase(descriptor, minted, scopeTag);
    if (!persistPendingVtuPurchases()) {
      pendingPurchases.delete(descriptor);
      if (priorTombstone !== undefined) {
        forgottenVtuScopes.set(descriptor, priorTombstone);
      }
      throw new Error(PENDING_VTU_STORAGE_ERROR);
    }
    return minted;
  }).then((key) => {
    if (key === null) {
      throw new Error(PENDING_VTU_STORAGE_ERROR);
    }
    return key;
  });
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  descriptor: string,
  reference: string
): void {
  const pending = pendingPurchases.get(descriptor);
  if (pending) {
    pending.reference = reference;
    schedulePendingVtuFlush();
  }
}

/** True when this reference was noted for the descriptor. */
export function hasNotedPendingVtuReference(
  descriptor: string,
  reference: string
): boolean {
  return hasNotedPendingVtuReferenceIn(pendingPurchases, descriptor, reference);
}

/** Records observed success on a RETAINED entry (first wins; immediate successes reset instead). */
export function markPendingVtuCompleted(
  descriptor: string,
  now: number = Date.now()
): void {
  // Locked flush (Codex R153 P1, web mirror): direct persist here
  // could clobber a sibling tab's just-minted key outside the mutex.
  markPendingVtuCompletedIn(
    pendingPurchases,
    schedulePendingVtuFlush,
    descriptor,
    now
  );
}

/** Staleness predicate (contract in isStalePendingVtuSuccessIn). Callers MUST forget and prompt fresh. */
export function isStalePendingVtuSuccess(
  descriptor: string,
  reference: string,
  now: number = Date.now()
): boolean {
  return isStalePendingVtuSuccessIn(
    pendingPurchases,
    descriptor,
    reference,
    now,
    PENDING_VTU_STALE_AFTER_MS
  );
}

/**
 * Forgets retained entries by NOTED server reference. SHOWN-context
 * only (history/backfill views displaying the result): an identical
 * repeat is a new intent that must mint fresh. Background passes
 * MUST use markSettledPendingVtuByReference instead (R68 6rwG9F).
 */
export function forgetPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  const scopes: string[] = [];
  for (const [descriptor, pending] of pendingPurchases) {
    if (pending.reference !== reference) continue;
    pendingPurchases.delete(descriptor);
    // Key-bound tombstone (Codex R143 P1): bind the deleted
    // generation so a sibling tab's newer generation survives.
    noteForgottenVtuScopes([descriptor], now, pending.key);
    scopes.push(descriptor);
  }
  if (scopes.length > 0) {
    schedulePendingVtuFlush();
  }
}

/** Settles background-observed terminal successes WITHOUT deleting
 * (R68 6rwG9F): marked entries are skipped (stale guard presents),
 * unmarked are marked already-stale ("Already Completed", no recharge). */
export function markSettledPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  let touched = false;
  for (const pending of pendingPurchases.values()) {
    if (pending.reference !== reference || pending.completedAt !== null) {
      continue;
    }
    pending.completedAt = now - PENDING_VTU_STALE_AFTER_MS - 1;
    touched = true;
  }
  if (touched) {
    schedulePendingVtuFlush();
  }
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(
  descriptor: string,
  now: number = Date.now()
): void {
  const live = pendingPurchases.get(descriptor);
  pendingPurchases.delete(descriptor);
  noteForgottenVtuScopes([descriptor], now, live?.key);
  schedulePendingVtuFlush();
}

/**
 * Noted references across live entries, deduped. With a scope tag,
 * other owners' tagged entries are excluded; untagged fail open.
 */
export function listNotedPendingVtuReferences(scopeTag?: string): string[] {
  syncPendingVtuPurchasesFromSnapshot();
  return listNotedPendingVtuReferencesFrom(pendingPurchases.values(), scopeTag);
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearPendingVtuKeys(): void {
  pendingPurchases.clear();
  clearForgottenVtuScopes();
  clearPendingVtuSnapshot();
}
