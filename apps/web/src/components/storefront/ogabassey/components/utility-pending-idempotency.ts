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
 * Cross-mount recall for wallet-only VTU idempotency keys (web).
 *
 * The key used to live in a `useUtilityPurchase` ref, so closing the
 * processing screen with Done unmounted it: reopening Utilities and
 * resubmitting the same purchase minted a fresh key and the server
 * debited a SECOND transaction. This module-level registry survives
 * remounts within the session, so a retry of the same purchase reuses
 * its key and the route's `vtu_idempotency_keys` row dedupes (returning
 * the live transaction state) instead of double-charging.
 *
 * Entries are keyed by the canonical purchase signature (mirroring the
 * server fingerprint), additionally scoped to the authenticated owner +
 * merchant (the signature itself omits identity, like the server hash):
 * same signature in means the same payload out, so recall can never
 * attach a key to a different purchase — and the server's 409 guard
 * stays the backstop if they ever diverge. Terminal outcomes
 * (success, key-rotating 4xx) MUST forget the signature, or a later
 * legitimate repeat purchase would reattach to a dead key.
 *
 * Durability: entries persist in localStorage (cross-tab) so a page
 * reload — or a retry in a new tab after a timeout — still replays
 * the same key instead of minting a fresh one and debiting twice.
 * All entries expire after a uniform 24h horizon (persisted and live
 * recall alike, regardless of reference state): 24h dwarfs any
 * plausible processing duration, while infinite retention would
 * accumulate unboundedly. Within the TTL the 5-minute stale window
 * arbitrates success replays of noted references against
 * `rememberedAt`.
 */

/** Sequential web UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

// Lockstep with the server fingerprint
// (`apps/web/src/lib/vtu-wallet-fingerprint.ts`): any field the server
// hashes that is missing here could attach one key to two payloads the
// server considers different (409 loop); any extra field here —
// cosmetic `customerName`/`customerPhone`, `merchantSlug`,
// `customerAddress` — could miss a legitimate retry when hydration or
// a profile update changes it between a timed-out submit and the
// retry (fresh key, double charge).
const SIGNATURE_FIELDS = [
  'amount',
  'billItemIdentifier',
  'billerCode',
  'billerName',
  'customerIdentifier',
  'dataPlanCode',
  'networkProvider',
  'phoneNumber',
  'productCode',
  'provider',
  'requireValidationRef',
  'type',
  // NOTE: validationReference excluded (ephemeral per-verification
  // artifact — see the server fingerprint note). Lockstep applies.
  'walletAmount',
] as const;

/**
 * Canonical retry signature for a wallet-only VTU payload. Field order
 * is fixed and absent values normalize to null (mirroring the
 * server's `?? null`), so two identical intents always sign
 * identically regardless of key insertion order.
 */
export function buildVtuWalletPayloadSignature(
  payload: Record<string, unknown>
): string {
  const canonical: Record<string, unknown> = {};
  for (const field of SIGNATURE_FIELDS) {
    canonical[field] = payload[field] ?? null;
  }
  return JSON.stringify(canonical);
}

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
 * Scopes deliberately deleted since the last persist. The cross-tab
 * sync must skip them, or it would resurrect just-forgotten,
 * TTL-dropped, or evicted entries from the not-yet-rewritten snapshot.
 * Cleared on every persist (the snapshot then matches the map).
 */
const forgottenScopedKeys = new Set<string>();

/** Serializes live entries for localStorage (prunes TTL-expired). */
export function serializePendingVtuPurchases(now: number = Date.now()): string {
  return serializePendingVtuEntries(pendingPurchases, now);
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
  for (const [scoped, entry] of parsePendingVtuSnapshot(serialized, now)) {
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
  for (const [scoped, entry] of parsePendingVtuSnapshot(
    loadPendingVtuSnapshot()
  )) {
    if (!forgottenScopedKeys.has(scoped) && !pendingPurchases.has(scoped)) {
      pendingPurchases.set(scoped, entry);
    }
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
 * Entries past the 24h TTL are dropped instead of recalled — including
 * referenced ones. No client-side signal proves terminality (noted
 * references mark non-terminal processing responses, and the server
 * leaves unconfirmed rows processing indefinitely), so retention is
 * horizon-based: 24h dwarfs any plausible processing duration, while
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
    forgottenScopedKeys.add(payloadSignature);
    persistPendingVtuPurchases();
    return undefined;
  }
  return pending.key;
}

/**
 * Frees one registry slot. Past-TTL entries go first (live recall
 * would drop them on access anyway, regardless of reference state).
 * Otherwise the oldest within-TTL entry goes — no client-side signal
 * proves terminality, so this documented last resort needs 33 live
 * purchases inside 24h to matter; staleness is deliberately NOT a
 * victim criterion (a referenced entry older than five minutes may
 * still be processing, and the stale branch needs its key).
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingPurchases) {
    if (now - entry.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
      pendingPurchases.delete(scoped);
      forgottenScopedKeys.add(scoped);
      return;
    }
  }
  const oldest = pendingPurchases.keys().next();
  if (!oldest.done) {
    pendingPurchases.delete(oldest.value);
    forgottenScopedKeys.add(oldest.value);
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
  forgottenScopedKeys.add(payloadSignature);
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
