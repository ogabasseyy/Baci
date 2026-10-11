/**
 * Cross-mount recall for wallet-only VTU idempotency keys.
 *
 * The key used to live in a `useUtilityPayment` ref, so navigating away
 * from a `202 processing` view ("Back to Home") and reopening Utilities
 * remounted the form with an empty key: resubmitting the same recipient
 * minted a fresh UUID and the server debited a SECOND transaction. This
 * module-level registry survives remounts within the session, so a retry
 * of the same purchase reuses its key and the route's
 * `vtu_idempotency_keys` row dedupes (returning the live transaction
 * state) instead of double-charging.
 *
 * Entries are keyed by a canonical purchase descriptor mirroring the
 * server fingerprint (`apps/web/src/lib/vtu-wallet-fingerprint.ts`),
 * additionally scoped to the authenticated owner + merchant (the
 * descriptor itself omits identity, like the server hash): same
 * descriptor in means the same payload out, so recall can never
 * attach a key to a different purchase — and the server's 409 guard
 * stays the backstop if they ever diverge. Terminal outcomes
 * (success, key-rotating 4xx) MUST forget the descriptor, or a later
 * legitimate repeat purchase would reattach to a dead key.
 *
 * Durability: entries persist in MMKV (device-scoped) so an app
 * restart between a timed-out submit and its retry still replays the
 * same key instead of minting a fresh one and debiting twice.
 * Persisted entries expire after 24h, and live recall enforces the
 * same TTL for reference-less entries (a timed-out submit that reached
 * the server completed long ago; replaying its key would present the
 * old success as a new purchase). Referenced entries keep recalling
 * however old — the stale check below arbitrates their success
 * replays, and expiring them could mint a fresh key for a still-
 * processing transaction (double debit). The 5-minute stale window
 * for already-completed detection still applies to `rememberedAt`.
 */

import {
  clearPendingVtuSnapshot,
  loadPendingVtuSnapshot,
  PERSISTED_VTU_KEY_TTL_MS,
  parsePendingVtuSnapshot,
  savePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-store';

// Lockstep with the server fingerprint fields: any field the server
// hashes that is missing here could attach one key to two payloads
// the server considers different (409 loop); any extra field here
// could miss a legitimate retry (fresh key, double charge).
const DESCRIPTOR_FIELDS = [
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
  'validationReference',
  'walletAmount',
] as const;

/** Sequential mobile UX never has more than a couple of pendings in flight. */
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

/** Serializes live entries for MMKV (prunes TTL-expired). */
export function serializePendingVtuPurchases(now: number = Date.now()): string {
  return serializePendingVtuEntries(pendingPurchases, now);
}

/**
 * Restores entries from a snapshot (same code path as restart).
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

function persistPendingVtuPurchases(): void {
  savePendingVtuSnapshot(serializePendingVtuPurchases());
}

// Restart recovery: rehydrate before any submit runs in this launch.
hydratePendingVtuPurchases(loadPendingVtuSnapshot());

/**
 * Binds a purchase descriptor to the submitting owner + merchant. The
 * descriptor deliberately omits identity (mirroring the server
 * fingerprint), so without this a sign-out + second customer could
 * recall the first customer's key for the same recipient/amount — and
 * the route rejects it as belonging to another customer. Callers MUST
 * scope ONCE per submission and pass the scoped key to every registry
 * call: a module-global scope would let an account switch mid-flight
 * redirect one customer's completion onto another customer's entry.
 */
export function scopePendingVtuKey(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined,
  descriptor: string
): string {
  return `${merchantId ?? ''}:${ownerId ?? ''}:${descriptor}`;
}

/**
 * Canonical descriptor for a wallet-only VTU payload. Field order is
 * fixed and absent values normalize to null (mirroring the server's
 * `?? null`), so two identical payloads always describe identically
 * regardless of key insertion order.
 */
export function buildVtuPurchaseDescriptor(
  payload: Record<string, unknown>
): string {
  const canonical: Record<string, unknown> = {};
  for (const field of DESCRIPTOR_FIELDS) {
    canonical[field] = payload[field] ?? null;
  }
  return JSON.stringify(canonical);
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
  descriptor: string,
  now: number = Date.now()
): string | null {
  const pending = pendingPurchases.get(descriptor);
  if (!pending) return null;
  if (now - pending.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
    pendingPurchases.delete(descriptor);
    persistPendingVtuPurchases();
    return null;
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
      return;
    }
  }
  const oldest = pendingPurchases.keys().next();
  if (!oldest.done) {
    pendingPurchases.delete(oldest.value);
  }
}

/** Records the key a purchase was submitted with (cap-enforced). */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string
): void {
  if (
    !pendingPurchases.has(descriptor) &&
    pendingPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  pendingPurchases.delete(descriptor);
  pendingPurchases.set(descriptor, {
    key,
    reference: null,
    rememberedAt: Date.now(),
  });
  persistPendingVtuPurchases();
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  descriptor: string,
  reference: string
): void {
  const pending = pendingPurchases.get(descriptor);
  if (pending) {
    pending.reference = reference;
    persistPendingVtuPurchases();
  }
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: the original submit is
 * older than the recall window, so this submit is a NEW intent, not a
 * retry. Callers MUST forget the descriptor and prompt a fresh submit
 * instead of presenting the earlier vend as the new purchase.
 * Reference-less entries (lost/timeout responses keep reference null
 * while the TTL retains them) are stale past the window too: their
 * first success past the window is the PRIOR transaction's, and
 * presenting it as the new purchase skips the new debit and vend.
 * Past the TTL recall already dropped them, so this predicate never
 * sees them.
 */
export function isStalePendingVtuSuccess(
  descriptor: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingPurchases.get(descriptor);
  if (!pending || now - pending.rememberedAt <= PENDING_VTU_STALE_AFTER_MS) {
    return false;
  }
  return pending.reference === null || pending.reference === reference;
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(descriptor: string): void {
  pendingPurchases.delete(descriptor);
  persistPendingVtuPurchases();
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearPendingVtuKeys(): void {
  pendingPurchases.clear();
  clearPendingVtuSnapshot();
}
