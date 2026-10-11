import { createWalletIdempotencyKey } from './utility-checkout';

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
 * Durability: entries persist in sessionStorage (tab-scoped) so a page
 * reload between a timed-out submit and its retry still replays the
 * same key instead of minting a fresh one and debiting twice.
 * Persisted entries expire after 24h; the 5-minute stale window for
 * already-completed detection still applies to `rememberedAt`.
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
  'validationReference',
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
 * How long a persisted entry survives across reloads. Independent of
 * the 5-minute stale window (which governs already-completed
 * detection): a reloaded-then-retried purchase needs its ORIGINAL key
 * however old, and the stale check still correctly flags it as
 * already-completed when the remembered reference matches.
 */
const PERSISTED_VTU_KEY_TTL_MS = 24 * 60 * 60 * 1000;

const VTU_PENDING_KEYS_STORAGE_KEY = 'baci:vtu-pending-keys/v1';

interface PersistedPendingVtuPurchase {
  key: string;
  reference: string | null;
  rememberedAt: number;
}

function isPersistedEntry(
  value: unknown
): value is [string, PersistedPendingVtuPurchase] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const [scoped, entry] = value;
  return (
    typeof scoped === 'string' &&
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as PersistedPendingVtuPurchase).key === 'string' &&
    typeof (entry as PersistedPendingVtuPurchase).rememberedAt === 'number'
  );
}

/** Serializes live entries for sessionStorage (prunes TTL-expired). */
export function serializePendingVtuPurchases(now: number = Date.now()): string {
  const live: [string, PersistedPendingVtuPurchase][] = [];
  for (const [scoped, entry] of pendingPurchases) {
    if (now - entry.rememberedAt <= PERSISTED_VTU_KEY_TTL_MS) {
      live.push([
        scoped,
        {
          key: entry.key,
          reference: entry.reference,
          rememberedAt: entry.rememberedAt,
        },
      ]);
    }
  }
  return JSON.stringify(live);
}

/**
 * Restores entries from a snapshot (same code path as reload). Corrupt
 * snapshots and TTL-expired entries are dropped; in-memory entries win
 * over persisted ones so hydration never clobbers a live attempt.
 */
export function hydratePendingVtuPurchases(
  serialized: string | null,
  now: number = Date.now()
): void {
  if (!serialized) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) {
    return;
  }
  for (const item of parsed) {
    if (!isPersistedEntry(item)) {
      continue;
    }
    const [scoped, entry] = item;
    if (
      now - entry.rememberedAt > PERSISTED_VTU_KEY_TTL_MS ||
      pendingPurchases.has(scoped)
    ) {
      continue;
    }
    pendingPurchases.set(scoped, {
      key: entry.key,
      reference: entry.reference ?? null,
      rememberedAt: entry.rememberedAt,
    });
  }
}

function readSessionSnapshot(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage.getItem(VTU_PENDING_KEYS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistPendingVtuPurchases(): void {
  try {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    sessionStorage.setItem(
      VTU_PENDING_KEYS_STORAGE_KEY,
      serializePendingVtuPurchases()
    );
  } catch {
    // Private-mode quota errors and friends: persistence is best
    // effort; the in-memory registry still dedupes this session.
  }
}

// Reload recovery: rehydrate before any submit runs in this tab.
hydratePendingVtuPurchases(readSessionSnapshot());

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

export function recallPendingVtuKey(
  payloadSignature: string
): string | undefined {
  return pendingPurchases.get(payloadSignature)?.key;
}

export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string
): void {
  if (
    !pendingPurchases.has(payloadSignature) &&
    pendingPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    // Drop the oldest entry rather than growing without bound; the
    // evicted purchase falls back to minting a fresh key on retry.
    const oldest = pendingPurchases.keys().next();
    if (!oldest.done) {
      pendingPurchases.delete(oldest.value);
    }
  }
  pendingPurchases.delete(payloadSignature);
  pendingPurchases.set(payloadSignature, {
    key,
    reference: null,
    rememberedAt: Date.now(),
  });
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
 * instead of resolving the current submit: same remembered reference,
 * but the original submit is older than the recall window. Callers
 * MUST forget the signature and prompt a fresh submit instead of
 * presenting the earlier vend as the new purchase. Reference-less
 * entries (network-error submits that never got a response) always
 * resolve normally — their first success IS the resolution.
 */
export function isStalePendingVtuSuccess(
  payloadSignature: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingPurchases.get(payloadSignature);
  return (
    pending?.reference === reference &&
    now - pending.rememberedAt > PENDING_VTU_STALE_AFTER_MS
  );
}

export function forgetPendingVtuPurchase(payloadSignature: string): void {
  pendingPurchases.delete(payloadSignature);
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
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(VTU_PENDING_KEYS_STORAGE_KEY);
    }
  } catch {
    // Best effort (see persistPendingVtuPurchases).
  }
}
