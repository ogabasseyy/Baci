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
 * (a real mutex) and uses this only where locks are unavailable.
 * Bounded 1ms spin; TTL-gated steal for crashed holders. Null =
 * unacquired; the caller fails closed (no key, no POST).
 */
export const PENDING_VTU_MINT_LOCK_TTL_MS = 1000;
export const PENDING_VTU_MINT_LOCK_WAIT_MS = 250;

function spinWaitMs(ms: number): number {
  const end = Date.now() + ms;
  let now = Date.now();
  while (now < end) {
    now = Date.now();
  }
  return now;
}

export function acquirePendingVtuMintLock(
  now: number = Date.now()
): string | null {
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
    at = spinWaitMs(1);
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
