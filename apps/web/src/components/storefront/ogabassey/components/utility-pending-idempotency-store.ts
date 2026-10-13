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
