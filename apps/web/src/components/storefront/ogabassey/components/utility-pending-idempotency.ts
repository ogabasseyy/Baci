import { createWalletIdempotencyKey } from './utility-checkout';
import {
  clearPendingVtuSnapshot,
  runPendingVtuMintLocked,
} from './utility-pending-idempotency-store';
import { isExpiredPendingVtuEntry } from './utility-pending-vtu-codec';
import {
  isStalePendingVtuSuccessIn,
  markPendingVtuCompletedIn,
} from './utility-pending-vtu-reference-queries';
export {
  hasNotedPendingVtuReference,
  listNotedPendingVtuReferences,
  notePendingVtuReference,
} from './utility-pending-vtu-reference-registry';
export { forgetPendingVtuPurchaseDurable } from './utility-pending-vtu-sync';
import {
  forgottenScopedKeys,
  noteForgottenVtuScope,
  pendingVtuPurchases,
  persistPendingVtuPurchases,
  schedulePendingVtuFlush,
  syncPendingVtuPurchasesFromSnapshot,
} from './utility-pending-vtu-sync';

/**
 * Cross-mount recall for wallet-only VTU idempotency keys (web):
 * retries reuse the key and the route's claim dedupes instead of
 * double-charging. Entries key by canonical purchase signature
 * (scoped owner+merchant, SHA-256). Deletion rule (R68): only a
 * view that just showed a result may forget it. Sync/scoping in
 * sibling modules; ops live here.
 */

/** Sequential web UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

/**
 * Recall window for a remembered key. A success replay older than
 * this is a NEW intent reusing a completed key — never apply it.
 */
export const PENDING_VTU_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Key previously used for this exact purchase, if it is still pending.
 * Referenced-but-uncompleted entries are retained past the 7-day TTL
 * (the server leaves unconfirmed rows processing indefinitely); all
 * other TTL-aged entries drop. The 5min stale check still arbitrates
 * success replays.
 */
export function recallPendingVtuKey(
  payloadSignature: string,
  now: number = Date.now()
): string | undefined {
  syncPendingVtuPurchasesFromSnapshot();
  const pending = pendingVtuPurchases.get(payloadSignature);
  if (!pending) return undefined;
  if (isExpiredPendingVtuEntry(pending, now)) {
    pendingVtuPurchases.delete(payloadSignature);
    noteForgottenVtuScope(payloadSignature, now, pending.key);
    schedulePendingVtuFlush();
    return undefined;
  }
  return pending.key;
}

/**
 * Frees one slot by dropping an EXPIRED entry (recall would drop it
 * anyway). TTL-retained entries are never victims — the registry
 * overflows instead (their retry would mint fresh and double-debit).
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingVtuPurchases) {
    if (isExpiredPendingVtuEntry(entry, now)) {
      pendingVtuPurchases.delete(scoped);
      noteForgottenVtuScope(scoped, now, entry.key);
      return;
    }
  }
}

/** Memory admission for a minted key, cap-enforced (sync; durability
 * is a scheduled locked flush — R152 P1; R96 P1, R99 P2 mirror). */
export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string,
  scopeTag?: string
): void {
  if (
    !pendingVtuPurchases.has(payloadSignature) &&
    pendingVtuPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  pendingVtuPurchases.delete(payloadSignature);
  pendingVtuPurchases.set(payloadSignature, {
    key,
    reference: null,
    ...(scopeTag !== undefined ? { scopeTag } : {}),
    rememberedAt: Date.now(),
    completedAt: null,
  });
  forgottenScopedKeys.delete(payloadSignature);
  schedulePendingVtuFlush();
}

/** Rebinds a minted entry to the server's canonical (winner) key
 * after an intent-claim join, preserving reference/scopeTag/
 * completion. No-op when the entry is missing (forgotten/rotated
 * meanwhile — never resurrect) or already canonical. */
export function adoptCanonicalVtuKey(
  payloadSignature: string,
  key: string
): void {
  const entry = pendingVtuPurchases.get(payloadSignature);
  if (!entry || entry.key === key) {
    return;
  }
  pendingVtuPurchases.set(payloadSignature, { ...entry, key });
  schedulePendingVtuFlush();
}

/** Attaches the server reference once a non-terminal response arrives. */
/**
 * Records that terminal success was observed on a RETAINED entry (the
 * switched-success path, which notes without forgetting). Immediate
 * successes forget the entry instead, so they never need this. The
 * timestamp lets the stale predicate distinguish a slow first
 * completion (present it) from a repeat long after completion
 * ("Already Completed"). First observation wins: re-marking must not
 * extend the window.
 */
export function markPendingVtuCompleted(
  payloadSignature: string,
  now: number = Date.now()
): void {
  // Locked flush (Codex R153 P1): a direct persist here could
  // clobber a sibling tab's just-minted key outside the mutex.
  markPendingVtuCompletedIn(
    pendingVtuPurchases,
    schedulePendingVtuFlush,
    payloadSignature,
    now
  );
}

/**
 * Forgets retained entries by NOTED server reference. SHOWN-context
 * only (the voucher backfill, which just displayed the result): an
 * identical repeat is a new intent that must mint fresh and deliver
 * anew. Background passes MUST use markSettledPendingVtuByReference
 * instead — they observe terminality for results nobody saw, and
 * forgetting those would mint fresh on retry and debit twice (R68).
 */
export function forgetPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  let touched = false;
  for (const [scoped, pending] of pendingVtuPurchases) {
    if (pending.reference !== reference) {
      continue;
    }
    pendingVtuPurchases.delete(scoped);
    noteForgottenVtuScope(scoped, now, pending.key);
    touched = true;
  }
  if (touched) {
    schedulePendingVtuFlush();
  }
}

/**
 * Settles background-observed terminal successes WITHOUT deleting
 * (R68 6rwG9F). Marked (suppressed) entries are skipped — the stale
 * guard presents them on replay. Unmarked entries are marked with an
 * already-stale timestamp: the outcome was never shown in-session
 * (watched resolutions are forgotten by the backfill first), so the
 * retry is told "Already Completed" instead of double-charging.
 */
export function markSettledPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  let touched = false;
  for (const pending of pendingVtuPurchases.values()) {
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

/**
 * True when this reference resolves a previously-noted processing
 * response: the purchase already fired a refresh (and remounts
 * refetch), so the displayed balance already reflects the debit and
 * callers must refresh for server truth instead of decrementing
 * locally a second time.
 */
/** Staleness predicate (contract in isStalePendingVtuSuccessIn). Callers MUST forget and prompt fresh. */
export function isStalePendingVtuSuccess(
  payloadSignature: string,
  reference: string,
  now: number = Date.now()
): boolean {
  return isStalePendingVtuSuccessIn(
    pendingVtuPurchases,
    payloadSignature,
    reference,
    now,
    PENDING_VTU_STALE_AFTER_MS
  );
}

export function forgetPendingVtuPurchase(payloadSignature: string): void {
  // Bind the deleted generation: a newer in-flight key under the
  // same scope must survive this tombstone in other tabs (Codex
  // R55 6rrMIj). Unknown scope (no live entry) degrades to a
  // keyless tombstone with timestamp arbitration.
  const pending = pendingVtuPurchases.get(payloadSignature);
  pendingVtuPurchases.delete(payloadSignature);
  noteForgottenVtuScope(payloadSignature, Date.now(), pending?.key);
  schedulePendingVtuFlush();
}

/**
 * Settles ONE shown generation (Codex R137 P1): the backfill's
 * reference-forget already deleted it, and the success view's
 * settle runs after a render commit — so a newer same-scope key
 * minted cross-tab in between may already be live (imported by the
 * first forget's syncing persist). Deleting by scope here would
 * reap that newer generation (or write a keyless tombstone over
 * it); its retry would then mint fresh and debit twice. Instead
 * delete only the named generation and tombstone exactly it — a
 * newer key survives both the delete and the tombstone (key-bound
 * merge/delete in the sync module).
 */
export function forgetPendingVtuPurchaseGeneration(
  payloadSignature: string,
  key: string
): void {
  const live = pendingVtuPurchases.get(payloadSignature);
  if (live === undefined || live.key === key) {
    pendingVtuPurchases.delete(payloadSignature);
  }
  noteForgottenVtuScope(payloadSignature, Date.now(), key);
  schedulePendingVtuFlush();
}

const PENDING_VTU_STORAGE_ERROR =
  'Could not save this purchase for retry. Please check your browser storage and try again.';

/**
 * Recalled key, else mint + remember (mobile mirror) under the
 * navigator.locks mint mutex (R149). Throws the storage error
 * when the lock is unacquired or the mint is memory-only (R96 P1).
 */
export function getPendingVtuKey(
  payloadSignature: string,
  scopeTag?: string
): Promise<string> {
  return runPendingVtuMintLocked(() => {
    const recalled = recallPendingVtuKey(payloadSignature);
    if (recalled) {
      return recalled;
    }
    const minted = createWalletIdempotencyKey();
    // Inline persist under the held lock (R152 P1) + rollback on
    // failure (R99 P2): the save must be atomic with the recall.
    const priorTombstone = forgottenScopedKeys.get(payloadSignature);
    rememberPendingVtuPurchase(payloadSignature, minted, scopeTag);
    if (!persistPendingVtuPurchases()) {
      pendingVtuPurchases.delete(payloadSignature);
      if (priorTombstone !== undefined) {
        forgottenScopedKeys.set(payloadSignature, priorTombstone);
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

/** Test-only escape hatch: module state survives across renderHook mounts. */
export function clearPendingVtuKeys(): void {
  pendingVtuPurchases.clear();
  forgottenScopedKeys.clear();
  clearPendingVtuSnapshot();
}
