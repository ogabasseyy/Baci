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
}

/**
 * How long a persisted entry survives across restarts. Independent of
 * the 5-minute stale window: a restarted-then-retried purchase needs
 * its ORIGINAL key however old, and the stale check still correctly
 * flags it as already-completed when the remembered reference matches.
 */
export const PERSISTED_VTU_KEY_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Serializes live entries, pruning TTL-expired reference-less ones.
 * Referenced entries are exempt (mirrors live recall) so a
 * still-processing vend keeps its key across restarts instead of
 * minting a fresh debit.
 */
export function serializePendingVtuEntries(
  entries: Iterable<[string, PersistedPendingVtuPurchase]>,
  now: number = Date.now()
): string {
  const live: [string, PersistedPendingVtuPurchase][] = [];
  for (const [scoped, entry] of entries) {
    if (
      entry.reference ||
      now - entry.rememberedAt <= PERSISTED_VTU_KEY_TTL_MS
    ) {
      live.push([
        scoped,
        {
          key: entry.key,
          reference: entry.reference ?? null,
          rememberedAt: entry.rememberedAt,
        },
      ]);
    }
  }
  return JSON.stringify(live);
}

/**
 * Parses a snapshot back into entries. Corrupt snapshots and
 * TTL-expired reference-less entries are dropped (fail-open: losing
 * dedupe state is recoverable via the server idempotency key check).
 * Referenced entries are exempt (mirrors live recall).
 */
export function parsePendingVtuSnapshot(
  serialized: string | null,
  now: number = Date.now()
): [string, PersistedPendingVtuPurchase][] {
  if (!serialized) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (item): item is [string, PersistedPendingVtuPurchase] =>
      isPersistedEntry(item) &&
      (Boolean(item[1].reference) ||
        now - item[1].rememberedAt <= PERSISTED_VTU_KEY_TTL_MS)
  );
}

interface PendingVtuKeyStore {
  getString: (key: string) => string | null | undefined;
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

/** Best-effort write; failures leave the in-memory registry working. */
export function savePendingVtuSnapshot(serialized: string): void {
  try {
    getPendingVtuStorage()?.set(VTU_PENDING_KEYS_STORAGE_KEY, serialized);
  } catch {
    // Persistence is best effort; the in-memory registry still dedupes
    // this session.
  }
}
