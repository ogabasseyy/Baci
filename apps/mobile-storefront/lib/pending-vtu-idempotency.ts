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
 * Persisted entries expire after 24h; the 5-minute stale window for
 * already-completed detection still applies to `rememberedAt`.
 */

import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

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

/**
 * How long a persisted entry survives across restarts. Independent of
 * the 5-minute stale window (which governs already-completed
 * detection): a restarted-then-retried purchase needs its ORIGINAL key
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

/** Serializes live entries for MMKV (prunes TTL-expired). */
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
 * Restores entries from a snapshot (same code path as restart).
 * Corrupt snapshots and TTL-expired entries are dropped; in-memory
 * entries win over persisted ones so hydration never clobbers a live
 * attempt.
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

interface PendingVtuKeyStore {
  getString: (key: string) => string | null | undefined;
  set: (key: string, value: string) => void;
}

let keyStore: PendingVtuKeyStore | null | undefined;

/**
 * Lazily opens the MMKV bucket (isolated ID so zustand persistence
 * never collides). Synchronous by design: the submit path needs the
 * recall inline. Web/SSR and native failures degrade to memory-only.
 */
function getPendingVtuStorage(): PendingVtuKeyStore | null {
  if (keyStore !== undefined) {
    return keyStore;
  }
  try {
    if (Platform.OS === 'web') {
      keyStore = null;
      return keyStore;
    }
    keyStore = createMMKV({ id: 'baci-vtu-pending-keys' });
  } catch {
    keyStore = null;
  }
  return keyStore;
}

function readPersistedSnapshot(): string | null {
  try {
    return (
      getPendingVtuStorage()?.getString(VTU_PENDING_KEYS_STORAGE_KEY) ?? null
    );
  } catch {
    return null;
  }
}

function persistPendingVtuPurchases(): void {
  try {
    getPendingVtuStorage()?.set(
      VTU_PENDING_KEYS_STORAGE_KEY,
      serializePendingVtuPurchases()
    );
  } catch {
    // Persistence is best effort; the in-memory registry still dedupes
    // this session.
  }
}

// Restart recovery: rehydrate before any submit runs in this launch.
hydratePendingVtuPurchases(readPersistedSnapshot());

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

/** Key previously used for this exact purchase, if it is still pending. */
export function recallPendingVtuKey(descriptor: string): string | null {
  return pendingPurchases.get(descriptor)?.key ?? null;
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
  pendingPurchases.delete(descriptor);
  pendingPurchases.set(descriptor, {
    key,
    reference: null,
    rememberedAt: Date.now(),
  });
  while (pendingPurchases.size > MAX_PENDING_PURCHASES) {
    const oldest = pendingPurchases.keys().next();
    if (oldest.done) break;
    pendingPurchases.delete(oldest.value);
  }
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
  const pending = pendingPurchases.get(descriptor);
  return (
    pending?.reference === reference &&
    now - pending.rememberedAt > PENDING_VTU_STALE_AFTER_MS
  );
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(descriptor: string): void {
  pendingPurchases.delete(descriptor);
  persistPendingVtuPurchases();
}
