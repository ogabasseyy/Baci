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
 * Durability matches the ref it replaces: in-memory only. An app
 * restart still loses pending keys (restart recovery is a separate
 * feature); this closes the remount gap, not the relaunch gap.
 */

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

// Owner scope for every registry entry. The descriptor deliberately
// omits identity (mirroring the server fingerprint), so without this a
// sign-out + second customer could recall the first customer's key for
// the same recipient/amount — and the route rejects it as belonging to
// another customer. `useUtilityPayment` sets the scope from the auth
// store on every render; a single session has a single identity, so
// last-write is always the current owner.
let ownerScope = '::';

export function setPendingVtuOwnerScope(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined
): void {
  ownerScope = `${merchantId ?? ''}:${ownerId ?? ''}:`;
}

function scopedDescriptor(descriptor: string): string {
  return `${ownerScope}${descriptor}`;
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

/** Key previously used for this exact purchase, if it is still pending. */
export function recallPendingVtuKey(descriptor: string): string | null {
  return pendingPurchases.get(scopedDescriptor(descriptor))?.key ?? null;
}

/**
 * Records the key a purchase was submitted with. Oldest entries evict
 * past the cap — eviction only drops the client recall (the server
 * dedupe row is unaffected), and 32 outstanding pendings is unreachable
 * through sequential taps.
 */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string
): void {
  const scoped = scopedDescriptor(descriptor);
  pendingPurchases.delete(scoped);
  pendingPurchases.set(scoped, {
    key,
    reference: null,
    rememberedAt: Date.now(),
  });
  while (pendingPurchases.size > MAX_PENDING_PURCHASES) {
    const oldest = pendingPurchases.keys().next();
    if (oldest.done) break;
    pendingPurchases.delete(oldest.value);
  }
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  descriptor: string,
  reference: string
): void {
  const pending = pendingPurchases.get(scopedDescriptor(descriptor));
  if (pending) pending.reference = reference;
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: same remembered reference,
 * but the original submit is older than the recall window. Callers
 * MUST forget the descriptor and prompt a fresh submit instead of
 * presenting the earlier vend as the new purchase. Reference-less
 * entries (network-error submits that never got a response) always
 * resolve normally — their first success IS the resolution.
 */
export function isStalePendingVtuSuccess(
  descriptor: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingPurchases.get(scopedDescriptor(descriptor));
  return (
    pending?.reference === reference &&
    now - pending.rememberedAt > PENDING_VTU_STALE_AFTER_MS
  );
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(descriptor: string): void {
  pendingPurchases.delete(scopedDescriptor(descriptor));
}
