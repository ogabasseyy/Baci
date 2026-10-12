/**
 * MMKV persistence for the pending-VTU registry.
 *
 * Extracted from `pending-vtu-idempotency.ts` to keep the registry under
 * budget; it owns all serialization, TTL pruning, and MMKV access.
 * Pure codec fns (serialize/parse) are MMKV-free and safe to import
 * anywhere; the MMKV touchpoints stay lazy and try/catch-guarded so
 * web/SSR (where `createMMKV` throws) degrades to memory-only.
 */
import { createMMKV } from 'react-native-mmkv';

interface PersistedPendingVtuPurchase {
  key: string;
  reference: string | null;
  rememberedAt: number;
  /** Absent for entries snapshotted before completion tracking shipped. */
  completedAt?: number | null;
}

/**
 * Deletion tombstone: a scope the registry deliberately forgot. Without
 * these, a failed MMKV write leaves the stale snapshot holding the
 * just-completed entry, and the next restart resurrects its old key —
 * an identical purchase then presents the previous vend as new
 * without charging. `forgottenAt` arbitrates against re-remember: an
 * entry remembered after the tombstone wins. Mirrors web's
 * `PersistedVtuTombstone` (single runtime here, so no cross-tab merge
 * — the codec suppresses snapshot entries directly).
 */
export interface PersistedVtuTombstone {
  scoped: string;
  forgottenAt: number;
}

export interface ParsedPendingVtuSnapshot {
  entries: [string, PersistedPendingVtuPurchase][];
  forgotten: PersistedVtuTombstone[];
}

/**
 * How long a persisted entry survives across restarts. Independent of
 * the 5-minute stale window: a restarted-then-retried purchase needs
 * its ORIGINAL key however old, and the stale check still correctly
 * flags it as already-completed when the remembered reference matches.
 */
export const PERSISTED_VTU_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const VTU_PENDING_KEYS_STORAGE_KEY = 'baci:vtu-pending-keys/v1';

function isPersistedEntry(
  item: unknown
): item is [string, PersistedPendingVtuPurchase] {
  if (!Array.isArray(item) || item.length !== 2) {
    return false;
  }
  const [scoped, entry] = item as [unknown, unknown];
  if (typeof scoped !== 'string' || typeof entry !== 'object' || !entry) {
    return false;
  }
  return (
    typeof (entry as PersistedPendingVtuPurchase).key === 'string' &&
    typeof (entry as PersistedPendingVtuPurchase).rememberedAt === 'number'
  );
}

function isPersistedTombstone(item: unknown): item is PersistedVtuTombstone {
  if (typeof item !== 'object' || !item) {
    return false;
  }
  const candidate = item as PersistedVtuTombstone;
  return (
    typeof candidate.scoped === 'string' &&
    typeof candidate.forgottenAt === 'number'
  );
}

/**
 * Serializes live entries + tombstones, pruning TTL-expired ones of
 * any reference state — mirrors live recall, so a single uniform
 * 7-day horizon governs retention everywhere.
 */
export function serializePendingVtuEntries(
  entries: Iterable<[string, PersistedPendingVtuPurchase]>,
  forgotten: Iterable<PersistedVtuTombstone>,
  now: number = Date.now()
): string {
  const live: [string, PersistedPendingVtuPurchase][] = [];
  for (const [scoped, entry] of entries) {
    if (now - entry.rememberedAt <= PERSISTED_VTU_KEY_TTL_MS) {
      live.push([
        scoped,
        {
          key: entry.key,
          reference: entry.reference ?? null,
          rememberedAt: entry.rememberedAt,
          completedAt: entry.completedAt ?? null,
        },
      ]);
    }
  }
  const liveForgotten: PersistedVtuTombstone[] = [];
  for (const tombstone of forgotten) {
    if (now - tombstone.forgottenAt <= PERSISTED_VTU_KEY_TTL_MS) {
      liveForgotten.push({
        scoped: tombstone.scoped,
        forgottenAt: tombstone.forgottenAt,
      });
    }
  }
  return JSON.stringify({ entries: live, forgotten: liveForgotten });
}

/**
 * Parses a snapshot back into entries + tombstones. Corrupt snapshots
 * and TTL-expired items are dropped (fail-open: losing dedupe state
 * is recoverable via the server idempotency key check). Legacy
 * bare-array snapshots (entries only) still parse, with no
 * tombstones. Entries at or below their tombstone's generation are
 * suppressed HERE (mobile has one runtime, so unlike web there is no
 * live map to reconcile — hydrate only runs on an empty map).
 */
export function parsePendingVtuSnapshot(
  serialized: string | null,
  now: number = Date.now()
): ParsedPendingVtuSnapshot {
  const empty: ParsedPendingVtuSnapshot = { entries: [], forgotten: [] };
  if (!serialized) {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return empty;
  }
  // Legacy bare-array snapshots (entries only) still parse.
  const rawEntries: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { entries?: unknown } | null)?.entries;
  const rawForgotten: unknown = Array.isArray(parsed)
    ? []
    : (parsed as { forgotten?: unknown } | null)?.forgotten;
  const forgotten = (Array.isArray(rawForgotten) ? rawForgotten : [])
    .filter(isPersistedTombstone)
    .filter(
      (tombstone) => now - tombstone.forgottenAt <= PERSISTED_VTU_KEY_TTL_MS
    )
    .map((tombstone) => ({
      scoped: tombstone.scoped,
      forgottenAt: tombstone.forgottenAt,
    }));
  const tombstonedAt = new Map(
    forgotten.map((tombstone) => [tombstone.scoped, tombstone.forgottenAt])
  );
  const entries = (Array.isArray(rawEntries) ? rawEntries : [])
    .filter(
      (item): item is [string, PersistedPendingVtuPurchase] =>
        isPersistedEntry(item) &&
        now - item[1].rememberedAt <= PERSISTED_VTU_KEY_TTL_MS
    )
    .filter(
      ([scoped, entry]) => (tombstonedAt.get(scoped) ?? -1) < entry.rememberedAt
    )
    .map(([scoped, entry]): [string, PersistedPendingVtuPurchase] => [
      scoped,
      {
        key: entry.key,
        reference: entry.reference ?? null,
        rememberedAt: entry.rememberedAt,
        // Pre-completion-tracking snapshots omit this: fail open
        // (first replay presents success, then resets).
        completedAt:
          typeof entry.completedAt === 'number' ? entry.completedAt : null,
      },
    ]);
  return { entries, forgotten };
}

interface PendingVtuKeyStore {
  getString: (key: string) => string | null | undefined;
  remove: (key: string) => void;
  set: (key: string, value: string) => void;
}

let keyStore: PendingVtuKeyStore | null | undefined;

/**
 * Lazily opens the MMKV bucket (isolated ID so zustand persistence
 * never collides). Synchronous by design: the submit path needs the
 * recall inline. No Platform branch: on web/SSR createMMKV throws and
 * the catch below degrades to memory-only, same as any native
 * failure.
 */
function getPendingVtuStorage(): PendingVtuKeyStore | null {
  if (keyStore !== undefined) {
    return keyStore;
  }
  try {
    keyStore = createMMKV({ id: 'baci-vtu-pending-keys' });
  } catch {
    keyStore = null;
  }
  return keyStore;
}

/** Reads the persisted snapshot; null when unavailable. */
export function loadPendingVtuSnapshot(): string | null {
  try {
    return (
      getPendingVtuStorage()?.getString(VTU_PENDING_KEYS_STORAGE_KEY) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Best-effort write; failures leave the in-memory registry working.
 * Returns false when the write throws so callers retain deletion
 * tombstones for the next persist (see persistPendingVtuEntries).
 * Unavailable storage (web/SSR fallback) counts as success — there
 * is nothing to fail, mirroring web's localStorage-absent branch.
 */
export function savePendingVtuSnapshot(serialized: string): boolean {
  try {
    getPendingVtuStorage()?.set(VTU_PENDING_KEYS_STORAGE_KEY, serialized);
    return true;
  } catch {
    // Persistence is best effort; the in-memory registry still dedupes
    // this session.
    return false;
  }
}

/**
 * Scopes deliberately deleted since the last persist (scope ->
 * deletion time). Cleared only after a durable write: if the write
 * throws, the stale snapshot still holds the completed entries, and
 * clearing would resurrect them on the next restart.
 */
export const forgottenVtuScopes = new Map<string, number>();

/** Records deletion tombstones for scopes the registry just forgot. */
export function noteForgottenVtuScopes(
  scopes: string[],
  forgottenAt: number
): void {
  for (const scoped of scopes) {
    const known = forgottenVtuScopes.get(scoped);
    if (known === undefined || forgottenAt > known) {
      forgottenVtuScopes.set(scoped, forgottenAt);
    }
  }
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearForgottenVtuScopes(): void {
  forgottenVtuScopes.clear();
}

/**
 * Serializes live entries WITH tombstones and saves; tombstones clear
 * only after a durable write. Retained tombstones ride along on the
 * next persist instead of resurrecting the deleted entries.
 */
export function persistPendingVtuEntries(
  entries: Iterable<[string, PersistedPendingVtuPurchase]>,
  now: number = Date.now()
): boolean {
  const ok = savePendingVtuSnapshot(
    serializePendingVtuEntries(
      entries,
      [...forgottenVtuScopes].map(([scoped, forgottenAt]) => ({
        scoped,
        forgottenAt,
      })),
      now
    )
  );
  if (ok) {
    forgottenVtuScopes.clear();
  }
  return ok;
}

/** Best-effort delete; used by the registry's test-only clear. */
export function clearPendingVtuSnapshot(): void {
  try {
    getPendingVtuStorage()?.remove(VTU_PENDING_KEYS_STORAGE_KEY);
  } catch {
    // Persistence is best effort.
  }
}
