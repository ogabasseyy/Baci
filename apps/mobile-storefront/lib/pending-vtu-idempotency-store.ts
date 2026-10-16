/**
 * MMKV persistence for the pending-VTU registry.
 *
 * Owns the MMKV bucket, deletion-tombstone lifecycle, and persist
 * orchestration. Serialization lives in
 * `pending-vtu-idempotency-codec.ts` (Codex R56 6rrhXi). The MMKV
 * touchpoints stay lazy and try/catch-guarded so web/SSR (where
 * `createMMKV` throws) degrades to memory-only — and the web
 * fallback probe below catches the subtler case where MMKV silently
 * substitutes a module-local Map (Codex R125 P1).
 */
import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import type { PersistedPendingVtuPurchase } from './pending-vtu-idempotency-codec';
import { serializePendingVtuEntries } from './pending-vtu-idempotency-codec';

const VTU_PENDING_KEYS_STORAGE_KEY = 'baci:vtu-pending-keys/v1';
// Single global mint lock (Codex R148 P1, web mirror): one key,
// overwritten per acquire — no accumulation. A crashed holder leaves
// one stale record, TTL-gated and overwritten next acquire.
const VTU_MINT_LOCK_STORAGE_KEY = 'baci:vtu-mint-lock/v1';

export interface PendingVtuMintLock {
  token: string;
  at: number;
}

interface PendingVtuKeyStore {
  getString: (key: string) => string | null | undefined;
  remove: (key: string) => void;
  set: (key: string, value: string) => void;
}

let keyStore: PendingVtuKeyStore | null | undefined;

type WebStorageGlobal = typeof globalThis & {
  localStorage?: Storage | null;
};

/**
 * True when MMKV silently backs this store with its module-local Map:
 * Expo web without window.localStorage access (private mode,
 * blocked third-party storage). set() then succeeds without
 * surviving reload (Codex R125 P1) — the store must report
 * unavailable so save() returns false and the pre-POST guard
 * refuses, exactly like a null bucket. Probes access the way MMKV
 * itself does (getLocalStorage.js touches window.localStorage in
 * try/catch). Native (Platform.OS !== 'web') always uses durable
 * MMKV — never refuse there.
 */
function isMmkvWebFallbackActive(): boolean {
  if (Platform.OS !== 'web') {
    return false;
  }
  try {
    return (globalThis as WebStorageGlobal).localStorage == null;
  } catch {
    return true;
  }
}

/**
 * Lazily opens the MMKV bucket (isolated ID so zustand persistence
 * never collides). Synchronous by design: the submit path needs the
 * recall inline. On web/SSR createMMKV throws and the catch below
 * degrades to memory-only, same as any native failure; the
 * fallback probe runs per call (not cached with the bucket)
 * because storage access can flip mid-session, and a Map-backed
 * write must never report durable.
 */
function getPendingVtuStorage(): PendingVtuKeyStore | null {
  if (keyStore === undefined) {
    try {
      keyStore = createMMKV({ id: 'baci-vtu-pending-keys' });
    } catch {
      keyStore = null;
    }
  }
  if (keyStore && isMmkvWebFallbackActive()) {
    return null;
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
 * tombstones for the next persist (see persistPendingVtuEntries) —
 * and false when no store exists at all (Codex R97 P1): a null
 * bucket used to no-op into `true`, so the submit path treated a
 * memory-only key as durable and sent the checkout; after an
 * ambiguous response plus a restart the retry minted fresh and
 * could debit/vend twice. False reaches remember(), whose
 * pre-POST guard refuses the submission until storage works.
 */
export function savePendingVtuSnapshot(serialized: string): boolean {
  try {
    const store = getPendingVtuStorage();
    if (!store) {
      return false;
    }
    store.set(VTU_PENDING_KEYS_STORAGE_KEY, serialized);
    return true;
  } catch {
    // Persistence is best effort; the in-memory registry still dedupes
    // this session.
    return false;
  }
}

/**
 * Scopes deliberately deleted since the last persist (scope ->
 * deletion record). Cleared only after a durable write: if the write
 * throws, the stale snapshot still holds the completed entries, and
 * clearing would resurrect them on the next restart. Tombstones bind
 * the deleted generation's key (web R61 parity, Codex R143 P1) so a
 * newer generation survives an older generation's tombstone.
 */
export const forgottenVtuScopes = new Map<
  string,
  { forgottenAt: number; key?: string }
>();

/** Records deletion tombstones for scopes the registry just forgot. */
export function noteForgottenVtuScopes(
  scopes: string[],
  forgottenAt: number,
  key?: string
): void {
  for (const scoped of scopes) {
    const known = forgottenVtuScopes.get(scoped);
    if (known === undefined || forgottenAt > known.forgottenAt) {
      forgottenVtuScopes.set(scoped, { forgottenAt, key });
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
      [...forgottenVtuScopes].map(([scoped, record]) => ({
        scoped,
        forgottenAt: record.forgottenAt,
        ...(record.key !== undefined ? { key: record.key } : {}),
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

/** Reads the mint lock; null when free, malformed, or unavailable. */
export function loadPendingVtuMintLock(): PendingVtuMintLock | null {
  try {
    const raw = getPendingVtuStorage()?.getString(VTU_MINT_LOCK_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PendingVtuMintLock>;
    return typeof parsed.token === 'string' &&
      typeof parsed.at === 'number' &&
      Number.isFinite(parsed.at)
      ? { token: parsed.token, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

export function savePendingVtuMintLock(token: string, at: number): boolean {
  try {
    const store = getPendingVtuStorage();
    if (!store) {
      return false;
    }
    store.set(VTU_MINT_LOCK_STORAGE_KEY, JSON.stringify({ token, at }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingVtuMintLock(): void {
  try {
    getPendingVtuStorage()?.remove(VTU_MINT_LOCK_STORAGE_KEY);
  } catch {
    // Persistence is best effort.
  }
}

/** navigator.locks name for the mint mutex (Muse R149 M1, web mirror). */
export const PENDING_VTU_MINT_LOCK_NAME = 'baci:vtu-mint-lock/v1';

/**
 * Fallback mint-lock protocol (R148, honest R149 revision): the
 * token write + confirm re-read NARROWS the cross-tab mint race but
 * cannot close it — the bucket has no compare-and-swap, so two
 * Expo web tabs loading "no lock" in the same instant can both
 * confirm and both mint. The runner in the sync module prefers
 * navigator.locks (a real mutex), fails closed in multi-tab
 * browsers without it (Codex R152 P1, web mirror), and uses this
 * only for single-threaded runtimes (native, SSR), where the
 * confirm-retry protocol is atomic. Timer-polled wait (Muse R151
 * M1, web mirror): a
 * busy-spin would block the JS thread for the full budget — polls
 * yield between attempts. TTL-gated steal for crashed holders.
 * Null = unacquired; the caller fails closed (no key, no POST). A
 * null bucket already fails remember() closed, and the lock
 * follows the same semantics.
 */
export const PENDING_VTU_MINT_LOCK_TTL_MS = 1000;
export const PENDING_VTU_MINT_LOCK_WAIT_MS = 250;
const PENDING_VTU_MINT_LOCK_POLL_MS = 10;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquirePendingVtuMintLock(
  now: number = Date.now()
): Promise<string | null> {
  const token = `mint-${now}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
  const deadline = now + PENDING_VTU_MINT_LOCK_WAIT_MS;
  let at = now;
  while (at < deadline) {
    const held = loadPendingVtuMintLock();
    if (!held || at - held.at >= PENDING_VTU_MINT_LOCK_TTL_MS) {
      savePendingVtuMintLock(token, at);
      if (loadPendingVtuMintLock()?.token === token) {
        return token;
      }
    }
    await sleepMs(PENDING_VTU_MINT_LOCK_POLL_MS);
    at = Date.now();
  }
  return null;
}

export function releasePendingVtuMintLock(token: string): void {
  // Release only our own token: a TTL-expired successor's claim
  // must survive our finally.
  if (loadPendingVtuMintLock()?.token === token) {
    clearPendingVtuMintLock();
  }
}
