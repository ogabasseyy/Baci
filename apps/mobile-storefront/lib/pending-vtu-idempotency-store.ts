/**
 * MMKV persistence for the pending-VTU registry.
 *
 * Owns the MMKV bucket, deletion-tombstone lifecycle, and persist
 * orchestration. Serialization lives in
 * `pending-vtu-idempotency-codec.ts` (Codex R56 6rrhXi). The MMKV
 * touchpoints stay lazy and try/catch-guarded so web/SSR (where
 * `createMMKV` throws) degrades to memory-only.
 */
import { createMMKV } from 'react-native-mmkv';
import type { PersistedPendingVtuPurchase } from './pending-vtu-idempotency-codec';
import { serializePendingVtuEntries } from './pending-vtu-idempotency-codec';

const VTU_PENDING_KEYS_STORAGE_KEY = 'baci:vtu-pending-keys/v1';

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
