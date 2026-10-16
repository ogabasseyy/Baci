/**
 * localStorage backend for pending VTU idempotency keys (web).
 *
 * Owns the storage bucket only: load/save/clear under a single key,
 * degrading to null/vacuous off-DOM. Serialization lives in
 * `utility-pending-vtu-codec.ts` (Codex R56 6rrhXm); the registry
 * merges the snapshot on recall/persist. localStorage (not
 * sessionStorage): a timeout followed by a retry in a new tab must
 * recall the same key — tab-scoped storage would mint fresh and the
 * route would debit a second transaction.
 */
const VTU_PENDING_KEYS_STORAGE_KEY = 'baci:vtu-pending-keys/v1';
// Single global mint lock (Codex R148 P1): one key, overwritten per
// acquire — no per-descriptor accumulation. A crashed holder leaves
// one stale record, TTL-gated and overwritten next acquire.
const VTU_MINT_LOCK_STORAGE_KEY = 'baci:vtu-mint-lock/v1';

export interface PendingVtuMintLock {
  token: string;
  at: number;
}

export function loadPendingVtuSnapshot(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem(VTU_PENDING_KEYS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function savePendingVtuSnapshot(serialized: string): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      // No storage to fail (SSR): vacuously persisted.
      return true;
    }
    localStorage.setItem(VTU_PENDING_KEYS_STORAGE_KEY, serialized);
    return true;
  } catch {
    // Private-mode quota errors and friends: persistence is best
    // effort; the in-memory registry still dedupes this session.
    // Callers MUST retain deletion tombstones on false so the next
    // persist retries the write (see persistPendingVtuPurchases).
    return false;
  }
}

export function clearPendingVtuSnapshot(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(VTU_PENDING_KEYS_STORAGE_KEY);
    }
  } catch {
    // Best effort (see savePendingVtuSnapshot).
  }
}

export function loadPendingVtuMintLock(): PendingVtuMintLock | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(VTU_MINT_LOCK_STORAGE_KEY);
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

export function savePendingVtuMintLock(
  token: string,
  at: number
): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    localStorage.setItem(
      VTU_MINT_LOCK_STORAGE_KEY,
      JSON.stringify({ token, at })
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingVtuMintLock(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(VTU_MINT_LOCK_STORAGE_KEY);
    }
  } catch {
    // Best effort.
  }
}

/** navigator.locks name for the mint mutex (Muse R149 M1). */
export const PENDING_VTU_MINT_LOCK_NAME = 'baci:vtu-mint-lock/v1';

/**
 * Fallback mint-lock protocol (R148, honest R149 revision): the
 * token write + confirm re-read NARROWS the cross-tab mint race but
 * cannot close it — localStorage has no compare-and-swap, so two
 * tabs loading "no lock" in the same instant can both confirm and
 * both mint. The runner in the sync module prefers navigator.locks
 * (a real mutex), fails closed in multi-tab browsers without it
 * (Codex R152 P1), and uses this only for single-threaded
 * runtimes (SSR, React Native), where it is atomic.
 * Timer-polled wait (Muse R151 M1): a busy-spin would block the
 * main thread for the full budget — polls yield between attempts.
 * TTL-gated steal for crashed holders. Null = unacquired; the
 * caller fails closed (no key, no POST).
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
  if (typeof localStorage === 'undefined') {
    return `ssr-${now}`;
  }
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

/**
 * Cross-tab mint mutex runner (Codex R148 P1, real mutex R149):
 * the recall → mint → remember triple runs under navigator.locks
 * where available — a genuine cross-tab mutex, so exactly one tab
 * mints per descriptor race and the loser re-recalls inside the
 * lock, adopting the winner's key. Without locks, multi-tab
 * browsers fail closed (Codex R152 P1) — the storage-token
 * fallback below serves only single-threaded runtimes (SSR,
 * React Native), where it is atomic. Sync fn, single
 * global name (holds last ~1ms; cross-descriptor contention is a
 * non-issue). Null = fallback unacquired; the caller fails closed.
 * Callback throws (e.g. undurable remember) propagate — never fall
 * back around them, or a mint could run twice.
 */
interface VtuNavigatorLocks {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

function getNavigatorLocks(): VtuNavigatorLocks | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  return (navigator as Navigator & { locks?: VtuNavigatorLocks }).locks;
}

export const PENDING_VTU_LOCKS_UNAVAILABLE_ERROR =
  'Could not secure this purchase for retry. Please update your browser and try again.';

/**
 * True only in a real multi-tab browser (window AND document). SSR,
 * React Native, and Node lack document — single-threaded runtimes
 * where the storage fallback is atomic. jsdom counts as a browser
 * (it has both), which is exactly what the browser-branch tests
 * need.
 */
function isMultiTabBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export async function runPendingVtuMintLocked<T>(
  fn: () => T
): Promise<T | null> {
  const locks = getNavigatorLocks();
  if (locks) {
    // Deferred, not returned directly: some LockManager
    // implementations invoke a throwing callback synchronously,
    // which would escape as a sync throw (and can wedge the
    // manager's queue, hanging later holders). The hop keeps the
    // never-throws-synchronously contract on both branches.
    return Promise.resolve().then(() =>
      locks.request(PENDING_VTU_MINT_LOCK_NAME, () => fn())
    );
  }
  if (isMultiTabBrowser()) {
    // Fail closed (Codex R152 P1): a multi-tab browser without Web
    // Locks cannot exclude a sibling tab — the storage fallback has
    // no compare-and-swap, so minting here could double-debit. The
    // fallback survives only for single-threaded runtimes (SSR,
    // React Native), where the confirm-retry protocol is atomic.
    // Thrown from an async runner: a rejection, never sync.
    throw new Error(PENDING_VTU_LOCKS_UNAVAILABLE_ERROR);
  }
  const token = await acquirePendingVtuMintLock();
  if (!token) {
    return Promise.resolve(null);
  }
  // Deferred like the locks path: never throws synchronously, so
  // callers see one async contract from both branches. The token is
  // already held, so the microtask hop cannot interleave a rival.
  return Promise.resolve()
    .then(fn)
    .finally(() => releasePendingVtuMintLock(token));
}
