import { createWalletIdempotencyKey } from './utility-checkout';
import {
  PERSISTED_VTU_KEY_TTL_MS,
  clearPendingVtuSnapshot,
  loadPendingVtuSnapshot,
  parsePendingVtuSnapshot,
  savePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-idempotency-store';


/**
 * Cross-mount recall for wallet-only VTU idempotency keys (web). The
 * key used to live in a ref, so Done + resubmit minted fresh and the
 * server debited a SECOND transaction. This module registry survives
 * remounts, so retries reuse the key and the route's idempotency row
 * dedupes instead of double-charging.
 *
 * Entries key by canonical purchase signature (server-fingerprint
 * mirror), scoped to owner + merchant: same signature in means the
 * same payload out, with the server 409 guard as backstop. Terminal
 * outcomes MUST forget, or a later repeat buy reattaches to a dead key.
 *
 * Durability: localStorage (cross-tab) so reloads and new-tab
 * retries replay the same key. Uniform 7-day TTL everywhere
 * (persisted + live, any reference state); within it the 5-minute
 * stale window arbitrates success replays of noted references.
 */

/** Sequential web UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

/**
 * Recall window for a remembered key. Genuine resolutions land within
 * seconds of the submit; a success replay older than this is a NEW
 * purchase intent reusing a completed transaction's key, and applying
 * it would present the earlier vend as the new purchase.
 */
export const PENDING_VTU_STALE_AFTER_MS = 5 * 60 * 1000;

interface PendingVtuPurchase {
  key: string;
  /** Server reference once a response arrives; null while unsent/unanswered. */
  reference: string | null;
  /** Client-local timestamp of the original submit (elapsed math only). */
  rememberedAt: number;
}

const pendingPurchases = new Map<string, PendingVtuPurchase>();

/**
 * Scopes deliberately deleted since the last persist (scope ->
 * deletion time). Sync imports snapshot tombstones here too, so a
 * completed key deleted in another tab is dropped locally instead
 * of written back on the next persist. Cleared on every persist
 * (the snapshot then carries the tombstones).
 */
const forgottenScopedKeys = new Map<string, number>();

/** Serializes live entries for localStorage (prunes TTL-expired). */
export function serializePendingVtuPurchases(now: number = Date.now()): string {
  return serializePendingVtuEntries(
    pendingPurchases,
    [...forgottenScopedKeys].map(([scoped, forgottenAt]) => ({
      scoped,
      forgottenAt,
    })),
    now
  );
}

/**
 * Restores entries from a snapshot (same code path as reload).
 * In-memory entries win over persisted ones so hydration never
 * clobbers a live attempt.
 */
export function hydratePendingVtuPurchases(
  serialized: string | null,
  now: number = Date.now()
): void {
  for (const [scoped, entry] of parsePendingVtuSnapshot(serialized, now)
    .entries) {
    if (!pendingPurchases.has(scoped)) {
      pendingPurchases.set(scoped, entry);
    }
  }
}

/**
 * Merges entries another tab persisted since this tab loaded (live
 * entries win: this tab's own writes are fresher than the snapshot).
 * Without this, a retry in a second already-open tab would miss the
 * first tab's key, mint fresh, and double-debit. Simultaneous
 * cross-tab mints remain a known residual (sync recall cannot take an
 * async lock) — same class as double-device submits.
 */
function syncPendingVtuPurchasesFromSnapshot(): void {
  const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
  for (const { scoped, forgottenAt } of snapshot.forgotten) {
    const live = pendingPurchases.get(scoped);
    if (live && live.rememberedAt <= forgottenAt) {
      pendingPurchases.delete(scoped);
    }
    const known = forgottenScopedKeys.get(scoped);
    if (known === undefined || forgottenAt > known) {
      forgottenScopedKeys.set(scoped, forgottenAt);
    }
  }
  for (const [scoped, entry] of snapshot.entries) {
    if (pendingPurchases.has(scoped)) {
      continue;
    }
    const tombstonedAt = forgottenScopedKeys.get(scoped);
    // A re-remembered entry (newer than the tombstone) still merges:
    // only the deleted generation is suppressed.
    if (tombstonedAt !== undefined && entry.rememberedAt <= tombstonedAt) {
      continue;
    }
    pendingPurchases.set(scoped, entry);
  }
}

function persistPendingVtuPurchases(): void {
  syncPendingVtuPurchasesFromSnapshot();
  savePendingVtuSnapshot(serializePendingVtuPurchases());
  forgottenScopedKeys.clear();
}

// Reload recovery: rehydrate before any submit runs in this browser.
hydratePendingVtuPurchases(loadPendingVtuSnapshot());

/**
 * Binds a purchase signature to the submitting owner + merchant. The
 * signature deliberately omits identity (mirroring the server
 * fingerprint), so without this a sign-out + second customer could
 * recall the first customer's key for the same purchase — and the
 * route rejects it as belonging to another customer. Callers MUST
 * scope ONCE per submission and pass the scoped key to every registry
 * call: a module-global scope would let an account switch mid-flight
 * redirect one customer's completion onto another customer's entry.
 */
export function scopePendingVtuSignature(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined,
  payloadSignature: string
): string {
  return `${merchantId ?? ''}:${ownerId ?? ''}:${payloadSignature}`;
}

/**
 * Key previously used for this exact purchase, if it is still pending.
 * Entries past the 7-day TTL are dropped instead of recalled — including
 * referenced ones. No client-side signal proves terminality (noted
 * references mark non-terminal processing responses, and the server
 * leaves unconfirmed rows processing indefinitely), so retention is
 * horizon-based: 7 days dwarf any plausible processing duration, while
 * infinite retention would accumulate unboundedly and wedge the cap.
 * The 5min stale check still arbitrates success replays within the TTL.
 */
export function recallPendingVtuKey(
  payloadSignature: string,
  now: number = Date.now()
): string | undefined {
  syncPendingVtuPurchasesFromSnapshot();
  const pending = pendingPurchases.get(payloadSignature);
  if (!pending) return undefined;
  if (now - pending.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
    pendingPurchases.delete(payloadSignature);
    forgottenScopedKeys.set(payloadSignature, now);
    persistPendingVtuPurchases();
    return undefined;
  }
  return pending.key;
}

/**
 * Frees one registry slot by dropping a past-TTL entry (live recall
 * would drop it on access anyway, regardless of reference state).
 * When every entry is still live the registry OVERFLOWS past the cap
 * instead of evicting: no client-side signal proves terminality, so
 * deleting a live attempt would lose deduplication and its retry
 * would mint fresh and double-debit. Entries are tiny and the 7-day
 * TTL bounds retention, so overflow is cheap and self-healing.
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingPurchases) {
    if (now - entry.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
      pendingPurchases.delete(scoped);
      forgottenScopedKeys.set(scoped, now);
      return;
    }
  }
}

export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string
): void {
  if (
    !pendingPurchases.has(payloadSignature) &&
    pendingPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  pendingPurchases.delete(payloadSignature);
  pendingPurchases.set(payloadSignature, {
    key,
    reference: null,
    rememberedAt: Date.now(),
  });
  forgottenScopedKeys.delete(payloadSignature);
  persistPendingVtuPurchases();
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  payloadSignature: string,
  reference: string
): void {
  const pending = pendingPurchases.get(payloadSignature);
  if (pending) {
    pending.reference = reference;
    persistPendingVtuPurchases();
  }
}

/**
 * True when this reference resolves a previously-noted processing
 * response: the purchase already fired a refresh (and remounts
 * refetch), so the displayed balance already reflects the debit and
 * callers must refresh for server truth instead of decrementing
 * locally a second time.
 */
export function hasNotedPendingVtuReference(
  payloadSignature: string,
  reference: string
): boolean {
  return pendingPurchases.get(payloadSignature)?.reference === reference;
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: same NOTED reference, but
 * the original submit is older than the recall window, so this submit
 * is a NEW intent, not a retry. Callers MUST forget the signature
 * and prompt a fresh submit instead of presenting the earlier vend as
 * the new purchase. Reference-less entries are NEVER stale: the user
 * saw failure (any success/processing response would have finalized
 * the entry), so a re-tap is definitionally a retry. Reusing the key
 * lets the authoritative server dedupe; forcing a fresh key would
 * assert non-existence the client cannot know and double-debit a slow
 * retry of an already-committed attempt. Past the TTL recall already
 * dropped them, so this predicate never sees them.
 */
export function isStalePendingVtuSuccess(
  payloadSignature: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingPurchases.get(payloadSignature);
  if (!pending || now - pending.rememberedAt <= PENDING_VTU_STALE_AFTER_MS) {
    return false;
  }
  return pending.reference !== null && pending.reference === reference;
}

export function forgetPendingVtuPurchase(payloadSignature: string): void {
  pendingPurchases.delete(payloadSignature);
  forgottenScopedKeys.set(payloadSignature, Date.now());
  persistPendingVtuPurchases();
}

/**
 * Returns the recalled key for this purchase, minting and remembering a
 * fresh one on first submit. Mirrors mobile's
 * `getWalletIdempotencyKey(descriptor)`.
 */
export function getPendingVtuKey(payloadSignature: string): string {
  const recalled = recallPendingVtuKey(payloadSignature);
  if (recalled) {
    return recalled;
  }
  const minted = createWalletIdempotencyKey();
  rememberPendingVtuPurchase(payloadSignature, minted);
  return minted;
}

/** Test-only escape hatch: module state survives across renderHook mounts. */
export function clearPendingVtuKeys(): void {
  pendingPurchases.clear();
  forgottenScopedKeys.clear();
  clearPendingVtuSnapshot();
}
